# Cookie editor workflows

The user approved adding Cookie-Editor workflows: compact inline editing, display options, and Header String export. They further requested a simple import text box and Import button, and export like Cookie-Editor.

Retain the existing native cookie commands and encrypted restore engine. Use a compact name list, editable expanded rows, and an action bar outside the scrolling list (Add, clear, Import, Export). Keep the dark monochrome browser palette: #1a1a1a panel, #202020 expanded content, #343434 separators, #929292 secondary text, #eeeeee primary text. Use inherited system UI typography, left-aligned labels, and monospace only for cookie contents. The screenshot's dense cookie list determines the layout; avoid large cookie cards.

Import's primary interface is one textarea and Import cookies. An optional disclosure holds file import and the existing restore policy selector; default Restore missing remains visible in its summary. Export offers JSON, Netscape, and Header String buttons that copy immediately. A preview/download disclosure also provides a manual copy fallback when the clipboard is unavailable. Header String omits attributes; warn about that loss. Never URI-encode existing values again.

Options offer simple/advanced editing, the extra field shown beside each cookie name, and top/bottom action bar placement. Store only those non-sensitive preferences locally. Values remain hidden in collapsed rows unless explicitly selected as extra information. Expanded rows edit name/value and always expose restore policy; advanced mode reveals all attributes without dropping hidden values when saving in simple mode. Add explicit copy-value controls. Keep confirmation and saved-copy semantics for deletion and both restore policies.

Approaches: retaining separate full editing screens would preserve today's extra navigation; replacing the native layer with an extension would duplicate an already working store. Extend the existing React panel and reuse the native layer. All-site cookie operations and extension-specific theme/DevTools/advertising settings are outside this requested workflow change.

Verification: test inline edits preserve hidden attributes, option persistence contains no cookie values, action controls stay visible while scrolling, paste/import works with the default and chosen restore modes, all three copy formats work, clipboard failure offers selectable output, file import/download still work, and the full browser suite passes. Package and replace the locally running browser build after verification.
