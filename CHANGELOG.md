# Changelog

## 0.1.0

- First release: Quicken and QuickBooks OFX statements (`.qfx`, `.qbo`) in a read-only viewer, parsed from SGML and XML with plain JavaScript, nothing to install.
- Transaction table with date, type, name, memo, amount and running balance, and a filter over the columns.
- Account and statement header facts: bank and account ids, currency, statement date range and OFX version.
- Signed totals for credits and debits, plus a pretty print of the raw OFX tags.
- Zovo Pro tool with 1 free try: batch-export parsed transactions to QBO and CSV files per account for bookkeeping import. Get Zovo Pro first shows what Pro includes and the tries left, in an editor tab.
