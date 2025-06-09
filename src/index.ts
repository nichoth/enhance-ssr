import { parse, parseFragment, serialize, serializeOuter } from 'parse5'
import type { DefaultTreeAdapterMap } from 'parse5'
import isCustomElement from './is-custom-element.js'
import { encode, decode } from './transcode.js'
import walk from './walk.mjs'
import { customAlphabet } from 'nanoid'
const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz'
const nanoid = customAlphabet(alphabet, 7)

type El = DefaultTreeAdapterMap['element']
type Child = DefaultTreeAdapterMap['childNode']

type HTMLify = (strings, values)=>string|{ head; body; }
type SeparatedHTML = (string, values)=>{ head; body; }

type EnhancerOptions = {
    initialState,
    elements,
    scriptTransforms,
    styleTransforms,
    uuidFunction,
    bodyContent,
    enhancedAttr,
    separateContent:boolean
}

export function Enhancer (options:Partial<EnhancerOptions> & {
    separatedContent: true
}):SeparatedHTML
export function Enhancer (
    options:Partial<EnhancerOptions> = {}
):HTMLify|SeparatedHTML {
    const {
        initialState = {},
        elements = [],
        scriptTransforms = [],
        styleTransforms = [],
        uuidFunction = nanoid,
        bodyContent = false,
        enhancedAttr = true,
        separateContent = false
    } = options
    const store = Object.assign({}, initialState)

    function processCustomElements ({ node }):{
        collectedStyles,
        collectedScripts,
        collectedLinks
    } {
        const collectedStyles:El[][] = []
        const collectedScripts:El[][] = []
        const collectedLinks:El[][] = []
        const context = {}

        walk(node, child => {
            if (isCustomElement(child.tagName)) {
                if (elements[child.tagName]) {
                    const {
                        frag: expandedTemplate,
                        styles: stylesToCollect,
                        scripts: scriptsToCollect,
                        links: linksToCollect
                    } = expandTemplate({
                        node: child,
                        elements,
                        state: {
                            context,
                            instanceID: uuidFunction(),
                            store
                        },
                        styleTransforms,
                        scriptTransforms
                    })

                    if (enhancedAttr) {
                        child.attrs.push({ name: 'enhanced', value: '✨' })
                    }
                    collectedScripts.push(scriptsToCollect)
                    collectedStyles.push(stylesToCollect)
                    collectedLinks.push(linksToCollect)
                    fillSlots(child, expandedTemplate)
                }
            }
        })

        return {
            collectedStyles,
            collectedScripts,
            collectedLinks
        }
    }

    function html (strings, ...values):string|{ head; body; } {
        const doc = parse(render(strings, ...values))
        const html:DefaultTreeAdapterMap['documentFragment'] = doc
            .childNodes
            .find(_node => {
                const node = _node as El
                return node.tagName === 'html'
            }) as DefaultTreeAdapterMap['documentFragment']

        const body = html.childNodes.find(node => (
            (node as El).tagName === 'body'
        )) as El

        const head = (html as El)
            .childNodes
            .find(_node => {
                const node = _node as El
                return node.tagName === 'head'
            }) as DefaultTreeAdapterMap['parentNode']

        const {
            collectedStyles,
            collectedScripts,
            collectedLinks
        } = processCustomElements({ node: body })

        if (collectedScripts.length) {
            const uniqueScripts = collectedScripts
                .flat()
                .reduce((acc, script) => {
                    const scriptSrc = script?.attrs?.find(a => a.name === 'src')
                    const scriptSrcValue = scriptSrc?.value
                    const scriptContents = script?.childNodes?.[0]?.value
                    if (scriptContents || scriptSrc) {
                        return {
                            ...acc,
                            [scriptContents || scriptSrcValue]: script
                        }
                    }
                    return { ...acc }
                }, {})

            appendNodes(body, Object.values(uniqueScripts))
        }

        if (collectedStyles.length) {
            const uniqueStyles = collectedStyles.flat().reduce((acc, style) => {
                if (style?.childNodes?.[0]?.value) {
                    return { ...acc, [style.childNodes[0].value]: '' }
                }
                return { ...acc }
            }, { })
            const mergedCss = Object.keys(uniqueStyles)
            mergedCss.sort((a, b) => {
                const aStart = a.trim().substring(0, 7)
                const bStart = b.trim().substring(0, 7)
                if (aStart === '@import' && bStart !== '@import') return -1
                if (aStart !== '@import' && bStart === '@import') return 1
                return 0
            })
            const mergedCssString = mergedCss.join('\n')
            const mergedStyles = (mergedCssString ?
                `<style>${mergedCssString}</style>` :
                '')
            if (mergedStyles) {
                const stylesNodeHead = [
                    parseFragment(mergedStyles).childNodes[0]
                ]
                appendNodes(head, stylesNodeHead)
            }
        }

        if (collectedLinks.length) {
            const uniqueLinks = collectedLinks.flat().reduce((acc, link) => {
                if (link) {
                    return {
                        ...acc,
                        [normalizeLinkHtml(link)]: link
                    }
                }
                return { ...acc }
            }, {})

            appendNodes(head, Object.values(uniqueLinks))
        }

        if (separateContent) {
            return {
                head: serialize(head).replace(/__b_\d+/g, ''), // NOTE: I'm not sure what these regexes are for but I copied them up
                body: serialize(body).replace(/__b_\d+/g, '')
            }
        } else {
            return (bodyContent ?
                serializeOuter(body.childNodes[0]) :
                serialize(doc)).replace(/__b_\d+/g, '')
        }
    }

    return html
}

function render (strings, ...values):string {
    const collect:string[] = []
    for (let i = 0; i < strings.length - 1; i++) {
        collect.push(strings[i], '' + encode(values[i]))
    }
    collect.push(strings[strings.length - 1])

    return collect.join('')
}

function expandTemplate ({
    node,
    elements,
    state,
    styleTransforms,
    scriptTransforms
}):{
    frag:DefaultTreeAdapterMap['documentFragment'];
    styles:El[];
    scripts:El[];
    links:El[];
} {
    const tagName = node.tagName
    const frag = renderTemplate({
        name: node.tagName,
        elements,
        attrs: node.attrs,
        state
    }) || ''
    const styles:El[] = []
    const scripts:El[] = []
    const links:El[] = []

    for (const node of frag.childNodes) {
        if (node.nodeName === 'script') {
            frag.childNodes.splice(frag.childNodes.indexOf(node), 1)
            const transformedScript = applyScriptTransforms({
                node,
                scriptTransforms,
                tagName
            })

            if (transformedScript) {
                scripts.push(transformedScript)
            }
        }

        if (node.nodeName === 'style') {
            frag.childNodes.splice(frag.childNodes.indexOf(node), 1)
            const transformedStyle = applyStyleTransforms({
                node,
                styleTransforms,
                tagName,
                context: 'markup'
            })
            if (transformedStyle) {
                styles.push(transformedStyle)
            }
        }

        if (node.nodeName === 'link') {
            frag.childNodes.splice(frag.childNodes.indexOf(node), 1)
            links.push(node)
        }
    }

    return { frag, styles, scripts, links }
}

function normalizeLinkHtml (_node) {
    const node = _node as El
    const attrs = Array.from(node.attrs)
        .sort((a, b) => {
            if (a.name < b.name) {
                return -1
            } else if (b.name < a.name) {
                return 1
            }
            return 0
        })
        .map(attr => `${attr.name}="${attr.value}"`)

    return `<link ${attrs.join(' ')} />`
}

type Attrs = DefaultTreeAdapterMap['element']['attrs']

function renderTemplate ({ name, elements, attrs = [], state = {} }:{
    name:string;
    elements:El[];
    attrs:Attrs;
    state;
}) {
    const newAttrs = attrs ? attrsToState(attrs) : []
    state.attrs = newAttrs
    const templateRenderFunction = (
        elements[name]?.render ||
        elements[name]?.prototype?.render
    )
    const template = templateRenderFunction || elements[name]

    if (template && typeof template === 'function') {
        return parseFragment(template({ html: render, state }))
    } else {
        throw new Error(`Could not find the template function for ${name}`)
    }
}

function attrsToState (attrs:Attrs = [], obj = {}):Record<string, string> {
    [...attrs].forEach(attr => {
        obj[attr.name] = decode(attr.value)
    })

    return obj
}

function fillSlots (node, template) {
    const slots = findSlots(template)
    const inserts = findInserts(node)
    const usedSlots:El[] = []
    const usedInserts:(Child|El)[] = []
    const unnamedSlots:[El, El][] = []

    for (let i = 0; i < slots.length; i++) {
        let hasSlotName = false
        const slot = slots[i]
        const slotAttrs = slot.attrs || []

        const slotAttrsLength = slotAttrs.length
        for (let i = 0; i < slotAttrsLength; i++) {
            const attr = slotAttrs[i]
            if (attr.name === 'name') {
                hasSlotName = true
                const slotName = attr.value
                const insertsLength = inserts.length
                for (let i = 0; i < insertsLength; i++) {
                    const insert = inserts[i]
                    const insertAttrs = insert.attrs || []

                    const insertAttrsLength = insertAttrs.length
                    for (let i = 0; i < insertAttrsLength; i++) {
                        const attr = insertAttrs[i]
                        if (attr.name === 'slot') {
                            const insertSlot = attr.value
                            if (insertSlot === slotName) {
                                const slotParentChildNodes = slot.parentNode!.childNodes
                                slotParentChildNodes.splice(
                                    slotParentChildNodes
                                        .indexOf(slot),
                                    1,
                                    insert
                                )
                                usedSlots.push(slot)
                                usedInserts.push(insert)
                            }
                        }
                    }
                }
            }
        }

        if (!hasSlotName) {
            unnamedSlots.push([slot, node])
        }
    }

    unnamedSlots.forEach(([slot, node]) => {
        const nodeChildren = node.childNodes
            .filter(node => !usedInserts.includes(node))
        const children = (nodeChildren.length ?
            nodeChildren :
            [...slot.childNodes])
        const slotParentChildNodes = slot.parentNode!.childNodes
        slotParentChildNodes.splice(
            slotParentChildNodes
                .indexOf(slot),
            1,
            ...children
        )
    })

    const unusedSlots = slots.filter(slot => !usedSlots.includes(slot))
    const nodeChildNodes = node.childNodes

    replaceSlots(template, unusedSlots)
    nodeChildNodes.splice(
        0,
        nodeChildNodes.length,
        ...template.childNodes
    )
}

function findSlots (node:El):El[] {
    const elements:El[] = []
    const find = (node) => {
        for (const child of node.childNodes) {
            if (child.tagName === 'slot') {
                elements.push(child)
            }
            if (child.childNodes) {
                find(child)
            }
        }
    }
    find(node)

    return elements
}

function findInserts (node:El):El[] {
    const elements:El[] = []
    const find = (node) => {
        for (const child of node.childNodes) {
            const hasSlot = child.attrs?.find(attr => attr.name === 'slot')
            if (hasSlot) {
                elements.push(child)
            }
        }
    }
    find(node)

    return elements
}

function replaceSlots (node, slots:El[]) {
    slots.forEach(slot => {
        const value = slot.attrs.find(attr => attr.name === 'name')?.value
        const asTag = slot.attrs.find(attr => attr.name === 'as')?.value
        const name = 'slot'
        const slotChildren = slot.childNodes.filter(n => {
            return !n.nodeName.startsWith('#')
        })

        if (value) {
            if (!slotChildren.length || slotChildren.length > 1) {
                // Only has text nodes
                const wrapperSpan:{
                    nodeName:string;
                    tagName:string;
                    attrs:{ value:string; name:string; }[];
                    namespaceURI:string;
                    childNodes:Child[]
                } = {
                    nodeName: asTag || 'span',
                    tagName: asTag || 'span',
                    attrs: [{ value, name }],
                    namespaceURI: 'http://www.w3.org/1999/xhtml',
                    childNodes: []
                }

                wrapperSpan.childNodes.push(...slot.childNodes)
                slot.childNodes.length = 0
                slot.childNodes.push(wrapperSpan as Child)
            }

            if (slotChildren.length === 1) {
                const child = slotChildren[0] as Child
                // Only add attrs if child is an element node
                if ('attrs' in child && Array.isArray((child as El).attrs)) {
                    (child as El).attrs.push({ value, name })
                }
            }

            const slotParentChildNodes = slot.parentNode?.childNodes
            if (slotParentChildNodes) {
                slotParentChildNodes.splice(
                    slotParentChildNodes
                        .indexOf(slot),
                    1,
                    ...slot.childNodes
                )
            }
        }
    })

    return node
}

function applyScriptTransforms ({
    node,
    scriptTransforms,
    tagName
}:{
    node:DefaultTreeAdapterMap['element'];
    scriptTransforms:(({ attrs, raw, tagName })=>string)[];
    tagName;
}):DefaultTreeAdapterMap['element'] {
    const attrs = node?.attrs || []
    if (node.childNodes.length) {
        const firstChild = node.childNodes[0]
        // const textNode = firstChild
        // Only access 'value' if it's a text node
        const raw = ('value' in firstChild) ?
            firstChild.value :
            ''
        let out = raw
        scriptTransforms.forEach(transform => {
            out = transform({ attrs, raw: out, tagName })
        })
        if (out.length) {
            (node.childNodes[0] as
                DefaultTreeAdapterMap['textNode']).value = out
        }
    }

    return node
}

function applyStyleTransforms ({
    node,
    styleTransforms,
    tagName,
    context = ''
}) {
    const attrs = node?.attrs || []
    if (node.childNodes.length) {
        const raw = node.childNodes[0].value
        let out = raw
        styleTransforms.forEach(transform => {
            out = transform({ attrs, raw: out, tagName, context })
        })
        if (out.length) {
            node.childNodes[0].value = out
        }
    }
    return node
}

function appendNodes (target, nodes) {
    target.childNodes.push(...nodes)
}

export default Enhancer
