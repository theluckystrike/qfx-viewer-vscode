# QFX / OFX Statement Viewer for VS Code

Open Quicken and QuickBooks OFX statements in the editor. A `.qfx` file is an SGML or XML envelope around bank transactions, and VS Code shows it as one long tagged blob. This extension parses the envelope and lists the transactions, without opening Quicken.

![QFX OFX Statement Viewer](images/screenshot.png)

## What it opens

- `.qfx` and `.qbo` files downloaded from banks and card issuers, both OFX flavors, read with plain JavaScript. Nothing to install, nothing uploaded.

## The free part

- Transaction table: date, type, name, memo, amount and running balance, in statement order, with a filter box over the columns.
- Account and statement header: bank id, account id and type, currency, and the date range the statement covers.
- Pretty print of the raw OFX tags, indented, for the lines the parser cannot map.
- File facts: transaction count, signed totals for credits and debits, and the OFX version the bank wrote.

## The Pro tool, with 1 free try

Pro adds the output step: batch-export the parsed transactions of one file or a whole folder to QBO files and CSV rows, named per account, ready for a bookkeeping import. Your first try of each Pro tool is free. Zovo Pro is USD 19 once, and the team licence is USD 59.

## Why not raw text

Statement review is a check job: did this download carry the whole month, what did the fee line cost, does the balance close. One tagged blob answers none of it. A transaction table with totals answers it in one screen.
