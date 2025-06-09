import { renderPage } from './page'

const data = {
    hello: 'world',
    easy: [1, 2, 3]
}

const [htmlHead, htmlBody] = renderPage(data)

console.log('**head**', htmlHead)

console.log('**body**', htmlBody)
