# עיצוב חשבון חלקי (Partial Invoice Designer)

Single-file web app (`app/index.html`) that takes a partial-invoice PDF for a subcontractor ("חשבון חלקי לקבלן משנה"), exported from the Electra ERP, and builds a designed, editable A4 document for download.

## Running
Open `app/index.html` in a browser. There is no build step and no server.
It needs internet access, because pdf.js and html2pdf.js load from cdnjs.

## Flow
1. **Upload**: drag and drop or pick a PDF (`takePdf`) → `pdfBuf`.
2. **Read**: `readPages` uses pdf.js to extract text items per page (`str, x, y, w, dir`).
3. **Parse**: `parseInvoice(pages)` is deterministic and coordinate-based. It returns `{ header:{company, doc, contractor}, fin, items }`:
   - fixes RTL/LTR text-direction quirks (`fix`) and merges fragments on the same line;
   - company block = top-right of page 1;
   - doc / contractor fields come from label regexes, with order-agnostic fallbacks (`codeLike`, `dateNear`);
   - items table: header columns are found by the "סעיף" and "תאור" headers. A role is mapped per column (code/desc/unit/cq/cum/pct/cur/price/total), and rows are anchored on code cells. Rows without a price become group names (`groups`);
   - payment page: anchored on "עבודות לפי חוזה". Amounts aligned to the main column go to `payment_rows`, the others are side values (e.g. קיזוז חו"ג).
4. **Render**: `render(data)` + `buildItems` (hierarchical code prefixes → מבנה/פרק/תת פרק headers and subtotals). The document is `contentEditable`.
5. **Checks**: `runChecks` runs these validations: qty×price per line, sum of lines vs "מחיר כולל", payment math, VAT, execution %, missing fields, dates, and non-integer quantities in unit items.
6. **Export**: html2pdf (A4, page numbers + account code in the footer) or the browser print dialog.

## Items table (פירוט סעיפים)
Columns are defined in `ITEM_COLS` (display order, header, width, cell value). PDF → app names: סעיף→מספר פעילות, תאור→תאור פעילות, יחידה→יח' מידה, כמות חוזה→כמות חוזה מעודכנת, מצטבר קודם→כמות מצטברת קודמת (role `prev`, when the PDF has it), כמות נוכחית, מחיר יחידה, תשלום %→ביצוע %, כמות מצטברת→כמות מצטברת נוכחית, סה"כ מצטבר→סכום מצטבר.
- **Computed:** `סכום נוכחי` = כמות נוכחית × מחיר יחידה (`curAmt`). It is also summed in subtotals.
- **Empty for now:** `כמות חוזה מקורית` has a header only. The user will define its logic later.

## Summary table (טבלה מסכמת)
`buildSummary(fin.summary)` renders on page 1, below the KPIs. Page 1 has no other financial tables, and the KPIs have no incl.-VAT tile. The data shape is `{ info:{orig, boq, incl_exc, balance, exc_mgr, overrun_mgr, adv_given, adv_left, due_date}, rows:[{label, op:'+'|'-'|'=', cur, cum, prev}], vat_rate }`.
- **Rule:** show only what the invoice contains. Rows render in invoice order, and missing info fields, rows or cards are not shown. Zero values are shown.
- **No data:** with no summary data at all, the full `SUM_TEMPLATE` catalogue renders as an empty template.
- **Blocks:** blocks (עבודות / התייקרויות / קיזוזים וניכויים / סיכום) are assigned by label (`SUM_GROUPS`). A `=` row closes the current block. An unknown `-` row goes to קיזוזים.
- **Emphasis:** the pre-VAT total is the emphasised row. The incl.-VAT total is a quiet row.
- **Parsing:** `parseInvoice` fills `fin.summary` from the payment page (op inferred from the label). The single amount column is split by `splitRows` into cum / prev / cur: rows up to the first "קודם" row are cumulative, that row is the previous total, and rows after it are current-period amounts. Per-row previous amounts are known only when the previous total is 0 (prev = 0, cur = cum). Otherwise only the total row right above the "קודם" row is split. The main column becomes `rows`, the חו"ג offset table becomes `offset`, plus contract scope, % execution and index linkage. The ERP writes gershayim as a single quote (סה'כ), which is normalised to ".
- **Columns:** order is מצטבר נוכחי, מצטבר קודם, סכום לתקופה נוכחית (`SUM_COLS`). Only columns that have data are shown.

## Notes
- The logo is stored via `window.storage` (the Claude-artifact API). The local fallback shim at the top of the script maps it to `localStorage`.
- `window.__renderDemo(data)` is a test hook: it renders data without a PDF.
- Hebrew UI, `dir="rtl"`. Numbers and Latin codes are wrapped LTR via `T()` / `L()` / `.num`.
- Brand colours are CSS variables in `:root` (navy `#1f3a5f`, amber `#e8a33d`).
