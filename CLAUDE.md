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
   - items table: header columns are found by the "סעיף" and "תאור" headers, and a role is mapped per column (code/desc/unit/cq/prev/cum/pct/cur/price/total).
     - **Row bands:** a row is the band from its top line, the first number left of the description, down to the next top line. In tall rows the code and unit are vertically centred.
     - **Page breaks:** the last band of a page is carried over (`carry`), so a row split across pages is completed by the text above the next page's first row.
     - **Currency marks:** "שח" tokens are dropped before merging, because they glue to the amounts.
     - **Groups:** rows without a price become group names (`groups`);
   - payment page: anchored on "עבודות לפי חוזה". Amounts aligned to the main column go to `payment_rows`, the others are side values (e.g. קיזוז חו"ג).
4. **Render**: `render(data)` + `buildItems` (hierarchical code prefixes → מבנה/פרק/תת פרק headers and subtotals). The document is `contentEditable`.
5. **Checks**: `runChecks` runs these validations: qty×price per line, sum of lines vs "מחיר כולל", payment math, VAT, execution %, missing fields, dates, and non-integer quantities in unit items.
6. **Export**: html2pdf (A4, page numbers + account code in the footer) or the browser print dialog.
   - **Scroll:** the window is scrolled to the top during export, with `scrollX/scrollY: 0`. html2canvas renders blank pages when the window is scrolled.
   - **RTL text:** `#doc.exporting *{letter-spacing:.01px}` forces per-character rendering. Otherwise RTL text loses its spaces.
   - **Repeated header:** `paginateItems` splits the items table into page-sized tables, each with its own header and with page breaks between them. A group heading moves with the row after it. The table is restored after the export. The print dialog repeats `thead` natively.

## Number format and header
- **Numbers:** decimals are shown only when the number has them (`money`: 1,267 / 7.20; `qty`: up to 3 decimals, none when whole).
- **Header:** the company header shows no branch (סניף) line.

## Structures table (ריכוז לפי מבנה)
This table comes right before "פירוט סעיפי החשבון", on the same page. It has one row per top-level structure ("סה"כ למבנה: <code> <name>", with its cumulative amount) and a "סה"כ" row. `buildItems` collects the rows (`structures`) while it builds the items table.

## Items table (פירוט סעיפים)
Columns are defined in `ITEM_COLS` (display order, header, width, cell value). PDF → app names: סעיף→מספר פעילות, תאור→תאור פעילות, יחידה→יח' מידה, כמות חוזה→כמות חוזה מעודכנת, מצטבר קודם→כמות מצטברת קודמת (role `prev`, when the PDF has it), כמות נוכחית, מחיר יחידה, תשלום %→ביצוע %, כמות מצטברת→כמות מצטברת נוכחית, סה"כ מצטבר→סכום מצטבר.
- **Computed:** `סכום נוכחי` = כמות נוכחית × מחיר יחידה (`curAmt`). It is also summed in subtotals.
- **Empty for now:** `כמות חוזה מקורית` has a header only. The user will define its logic later.

## User rules for the summary table – do not break
These were set by the user, and some were broken once and had to be fixed again. `tests/summary.test.js` checks them. Run it before every commit that touches the summary table: `NODE_PATH=$(npm root -g) node tests/summary.test.js`.
1. **Column order**, right to left: תיאור, סכום לחשבון חלקי, + / − / =, מצטבר קודם, מצטבר נוכחי.
2. **Indexation:**
   - **Grouping:** every row whose text is about indexation goes to the התייקרויות block, matched in any spelling (`IDX_RE`).
   - **Position:** it sits ABOVE "סה"כ כולל התייקרות", also when the invoice subtracts it only after that subtotal.
   - **Subtotal:** in that case the subtotal shown is recalculated to include it.
3. **No blank cells:**
   - a regular row without an amount for this invoice gets סכום לחשבון חלקי = 0 and מצטבר קודם = מצטבר נוכחי;
   - a subtotal without one gets the running sum of the rows above it;
   - when the solver cannot split two rows, the checks panel says so.
4. **Retention** (עכבון) is its own block, last before סיכום, closing with "סה"כ כולל עכבון".
5. **Deductions:** the deductions block closes with "מצטבר לאחר קיזוזים", which excludes retention.
6. **Hidden rows:** "סה"כ חשבון זה" and the "מצטבר … קודם" rows of סיכום are not shown. The "סה"כ" row covers them.
7. **The pre-VAT total** reads "סה"כ", and every column of it is filled.
8. **Duplicate row:** "… חשבון נוכחי (מצטבר: X)" is the current amount of the row whose cumulative is X. It is not shown as its own row.

## Summary table (טבלה מסכמת)
`buildSummary(fin.summary)` renders on page 1, below the KPIs. Page 1 has no other financial tables, and the KPIs have no incl.-VAT tile. The data shape is `{ info:{orig, boq, incl_exc, balance, exc_mgr, overrun_mgr, adv_given, adv_left, due_date}, rows:[{label, op:'+'|'-'|'=', cur, cum, prev}], vat_rate }`.
- **Rule:** show only what the invoice contains. Rows render in invoice order, and missing info fields, rows or cards are not shown. Zero values are shown.
- **No data:** with no summary data at all, the full `SUM_TEMPLATE` catalogue renders as an empty template.
- **Blocks:** blocks (עבודות / התייקרויות / קיזוזים וניכויים / סיכום) are assigned by label (`SUM_GROUPS`). A `=` row closes the current block. An unknown `-` row goes to קיזוזים.
  - **Indexation rows:** `IDX_RE` matches התייקרות / התיקרות / הצמדה / מדד, but not "לחישוב", the payable or VAT. See user rule 2.
  - **Retention:** retention (עכבון) is its own block, last before סיכום.
  - **Deductions subtotal:** the block's last `=` row is labelled "מצטבר לאחר קיזוזים" and excludes retention the invoice had already subtracted, so it plus retention = "סה"כ".
  - **Payable:** the payable from the חו"ג table, which is after the offsets, replaces the main table's.
  - **Block order:** blocks are rendered in the fixed order `SUM_ORDER`, so all deductions sit above the payable total.
  - **Offset rows:** the חו"ג offset rows are merged into the main table right after the "קודם" row, and rows that repeat a main label are dropped.
  - **Signs:** the + / − / = column sits between סכום לחשבון חלקי and the cumulative columns.
- **Emphasis:** the pre-VAT total is the emphasised row. It is labelled "סה"כ" and every column is summed, as a running sum over the rows above it in the invoice's own order (a `=` row replaces the sum). The invoice's own figures win. The incl.-VAT total is a quiet row.
- **Parsing:** `parseInvoice` fills `fin.summary` from the payment page (op inferred from the label). The single amount column is split by `splitRows` into cum / prev / cur.
  - **Row kinds:** rows up to the first "קודם" row are cumulative. That row is the previous total. Rows after it are this invoice's amounts.
  - **Current amounts:** for works (עבודות לפי חוזה) it is Σ סכום נוכחי of the BOQ (`boq_cur`), used only when the other works rows are 0. For indexation it is this invoice's "התייקרות שוטפת" in the indexation table (`idx_cur`).
  - **Other rows:** rows with amount 0 → 0.
  - **Solving from subtotals:** each subtotal (=) equals the subtotal before it plus the rows between them. When exactly one value in such a segment is unknown, it is solved, repeated until nothing changes. Two subtotals in a row with the same amount share the current amount. The previous amount is cum − cur.
  - **Signs:** a deduction already written as a negative amount is added as is.
  - **Known current amounts:**
    - a row whose cumulative equals the BOQ total (e.g. the works subtotal) gets `boq_cur`;
    - a percentage row (e.g. "פחות עכבון (5.00%)") is that % of the current amount of the subtotal above it, when the cumulative amounts agree;
    - a current-period row naming its cumulative ("… חשבון נוכחי (מצטבר: 431 003.37)") gives that row's current amount and is then dropped.
  - **Limit:** if two rows in one segment are still unknown, only their sum is determined and they stay blank.
  - **Deductions:** a label starting with "פחות" is a deduction.
  - **Fallbacks:** when the previous total is 0, prev = 0. Otherwise the total right above "קודם" is split by the previous total.
  - **Checks:** `runChecks` compares the computed previous total and invoice amount with the invoice's "מצטבר בחשבון קודם" and "סה"כ לתשלום". The main column becomes `rows`, the חו"ג offset table becomes `offset`, plus contract scope, % execution and index linkage. The ERP writes gershayim as a single quote (סה'כ), which is normalised to ".
- **Columns:** right to left: סכום לחשבון חלקי, מצטבר קודם, מצטבר נוכחי (`SUM_COLS`), so it reads חשבון + קודם = נוכחי. Only columns that have data are shown.

## Notes
- The logo is stored via `window.storage` (the Claude-artifact API). The local fallback shim at the top of the script maps it to `localStorage`.
- `window.__renderDemo(data)` is a test hook: it renders data without a PDF.
- Hebrew UI, `dir="rtl"`. Numbers and Latin codes are wrapped LTR via `T()` / `L()` / `.num`.
- Brand colours are CSS variables in `:root` (navy `#1f3a5f`, amber `#e8a33d`).
