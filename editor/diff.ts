// Editor di sola lettura per i file `.gitdiff` generati dal worker: diff affiancato.
// Il file contiene JSON { title, file, diff } con `diff` in formato unified (contesto completo).
import { DIFF_CSS, renderDiff, type DiffPayload } from '../shared/diff'
import { makeT } from '../shared/i18n'

declare const orca: {
  document?: {
    session<T>(options?: { merge?: (base: T, outside: T, mine: T) => T }): Promise<{
      value: T
      readOnly: boolean
      onReplace(cb: (v: T) => void): void
    }>
  }
}

function parse(text: string): DiffPayload {
  try {
    return JSON.parse(text) as DiffPayload
  } catch {
    return { title: makeT('en')('diffInvalid'), file: '', diff: '' }
  }
}

const style = document.createElement('style')
style.textContent = DIFF_CSS
document.head.append(style)
const root = document.createElement('div')
document.body.append(root)

const doc = await orca.document!.session<string>({ merge: (_base, outside) => outside })
renderDiff(root, parse(doc.value))
doc.onReplace((v) => renderDiff(root, parse(v)))
