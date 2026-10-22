import { test, expect } from 'vitest'
import { pathToFileURL } from 'url'
import { join } from 'path'
import { isOwnUrl } from '../../src/main/security'

const rendererDir = join('C:\\', 'Program Files', 'Leverage', 'resources', 'app.asar', 'out', 'renderer')
const page = (name: string, query = ''): string => pathToFileURL(join(rendererDir, name)).toString() + query

test("Leverage's bundled pages are its own, with or without a query string", () => {
  expect(isOwnUrl(page('index.html'), rendererDir)).toBe(true)
  expect(isOwnUrl(page('overlay.html', '?displayId=1'), rendererDir)).toBe(true)
})

test('any other local file is not', () => {
  expect(isOwnUrl(pathToFileURL('C:\\Users\\me\\Downloads\\evil.html').toString(), rendererDir)).toBe(false)
  // Sibling folder whose name merely starts with "renderer".
  expect(isOwnUrl(pathToFileURL(rendererDir + '-evil\\index.html').toString(), rendererDir)).toBe(false)
})

test('web pages are not, and the dev server only counts when given', () => {
  expect(isOwnUrl('https://example.com/', rendererDir)).toBe(false)
  expect(isOwnUrl('http://localhost:5173/overlay.html', rendererDir)).toBe(false)
  expect(isOwnUrl('http://localhost:5173/overlay.html', rendererDir, 'http://localhost:5173')).toBe(true)
  expect(isOwnUrl('http://localhost:51730/x', rendererDir, 'http://localhost:5173')).toBe(false)
})

test('garbage is not', () => {
  expect(isOwnUrl('', rendererDir)).toBe(false)
  expect(isOwnUrl('not a url', rendererDir)).toBe(false)
})
