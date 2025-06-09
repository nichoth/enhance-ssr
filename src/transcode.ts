const map = {}
let place = 0
export function encode (value:number):number
export function encode (value:string):string
export function encode (value:string|number):string|number
export function encode (value:unknown):number|string {
    if (typeof value === 'string') {
        return value
    } else if (typeof value === 'number') {
        return value
    } else {
        const id = `__b_${place++}`
        map[id] = value
        return id
    }
}

export function decode (value:string):string {
    return value.startsWith('__b_') ? map[value] : value
}
