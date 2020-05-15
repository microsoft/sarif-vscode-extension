// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

export {}

// Causing colorization issues if placed above Array.prototype...
// Ideally: ((_) => number) | ((_) => string)
type Selector<T> = (_: T) => number | string

declare global {
	interface ArrayConstructor {
		commonLength(a: any[], b: any[]): number
	}
	interface Array<T> {
		last: T
		replace(items: T[]) // From Mobx, but not showing up.
		remove(T): boolean // From Mobx, but not showing up.
		removeWhere(predicate: (T) => boolean): T | false
		sortBy<T>(this: T[], selector: Selector<T>, descending?: boolean): Array<T> // Not a copy
	}
	interface String {
		file: string
		path: string
	}
}

!Array.hasOwnProperty('commonLength') &&
Object.defineProperty(Array, 'commonLength', {
	value: function(a: any[], b: any[]): number {
		let i = 0
		for (; a[i] === b[i] && i < a.length && i < b.length; i++) {}
		return i
	}
})

!Array.prototype.hasOwnProperty('last') &&
Object.defineProperty(Array.prototype, 'last', {
	get: function() {
		return this[this.length - 1]
	}
})

!Array.prototype.hasOwnProperty('removeWhere') &&
Object.defineProperty(Array.prototype, 'removeWhere', {
	value: function(predicate: (T) => boolean) {
		const i = this.findIndex(predicate)
		return i >= 0 && this.splice(i, 1).pop()
	}
})

Array.prototype.sortBy = function<T>(selector: Selector<T>, descending = false) {
	this.sort((a, b) => {
		const aa = selector(a)
		const bb = selector(b)
		const invert = descending ? -1 : 1
		if (typeof aa === 'string' && typeof bb === 'string') return invert * aa.localeCompare(bb)
		if (typeof aa === 'number' && typeof bb === 'number') return invert * (aa - bb)
		return 0
	})
	return this
}

!String.prototype.hasOwnProperty('file') &&
Object.defineProperty(String.prototype, 'file', {
	get: function() {
		return this.substring(this.lastIndexOf('/') + 1, this.length)
	}
})

!String.prototype.hasOwnProperty('path') &&
Object.defineProperty(String.prototype, 'path', {
	get: function() {
		return this.substring(0, this.lastIndexOf('/')).replace(/^\//g, '')
	}
})
