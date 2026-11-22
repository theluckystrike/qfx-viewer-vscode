'use strict';
// Pro tools for QFX OFX Statement Viewer:
//   1. exportCsvQbo: Export one .qfx/.qbo statement or a folder of files to CSV and OFX 1.0.3 QBO
//      (with manifest.csv in batch mode). Never overwrites an existing file.
//   2. validateStatement: Check signon status, balances, date range, duplicate FITIDs and parse errors
//      across one file or a folder, opening a Markdown report in a new editor tab.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { parseQfx, buildCsv, buildQbo, buildValidationMarkdown, csvCell } = require('./qfx');

function uniquePath(targetPath) {
  if (!fs.existsSync(targetPath)) return targetPath;
  const dir = path.dirname(targetPath);
  const ext = path.extname(targetPath);
  const base = path.basename(targetPath, ext);
  for (let i = 1; i < 10000; i++) {
    const cand = path.join(dir, `${base}-${i}${ext}`);
    if (!fs.existsSync(cand)) return cand;
  }
  return path.join(dir, `${base}-${Date.now()}${ext}`);
}

async function resolveTargetUri(uri, provider) {
  if (uri && uri.scheme) return uri;
  if (provider && provider.active && provider.active.uri) return provider.active.uri;
  const ed = vscode.window.activeTextEditor;
  if (ed && ed.document && /\.(qfx|qbo)$/i.test(ed.document.uri.fsPath || ed.document.uri.path)) return ed.document.uri;
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { 'QFX / QBO Statement': ['qfx', 'qbo', 'QFX', 'QBO'] },
    openLabel: 'Select QFX or QBO file',
  });
  return picked && picked[0] ? picked[0] : null;
}

function listQfxFilesInDir(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && /\.(qfx|qbo)$/i.test(e.name))
    .map((e) => path.join(dirPath, e.name))
    .sort();
}

function createTools({ provider, pro, reach }) {
  async function exportCsvQbo(uri, opts = {}) {
    if (!(await pro.allowed('exportCsvQbo', opts))) return undefined;
    const target = await resolveTargetUri(uri, provider);
    if (!target) return undefined;

    const targetPath = target.fsPath;
    const isDir = target.scheme === 'file' && fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory();
    let scope = opts.scope;
    if (!scope) {
      if (isDir) {
        scope = 'folder';
      } else {
        const picked = await vscode.window.showQuickPick([
          { label: 'This statement file (CSV + QBO)', description: path.basename(targetPath), scope: 'file' },
          { label: 'All QFX/QBO files in this folder (with manifest.csv)', description: path.dirname(targetPath), scope: 'folder' },
        ], { title: 'Export statement to CSV and QBO: scope', placeHolder: 'Choose one file or the whole folder' });
        if (!picked) return undefined;
        scope = picked.scope;
      }
    }

    let format = opts.format;
    if (!format) {
      const picked = await vscode.window.showQuickPick([
        { label: 'CSV + QBO (both)', mode: 'both' },
        { label: 'CSV only (UTF-8)', mode: 'csv' },
        { label: 'CSV only (UTF-8 with BOM for Excel)', mode: 'csv-bom' },
        { label: 'QBO only (OFX 1.0.3 SGML)', mode: 'qbo' },
      ], { title: 'Export statement: output format', placeHolder: 'Choose the output format' });
      if (!picked) return undefined;
      format = picked.mode;
    }

    const useBom = format === 'csv-bom' || !!opts.bom;
    const wantCsv = format === 'both' || format === 'csv' || format === 'csv-bom';
    const wantQbo = format === 'both' || format === 'qbo';

    if (scope === 'file') {
      const bytes = await vscode.workspace.fs.readFile(target);
      const parsed = parseQfx(Buffer.from(bytes));
      const baseName = path.basename(targetPath, path.extname(targetPath));
      const extPrimary = wantCsv ? '.csv' : '.qbo';
      const defaultOut = uniquePath(path.join(path.dirname(targetPath), `${baseName}-export${extPrimary}`));
      const saveUri = opts.outPath
        ? vscode.Uri.file(uniquePath(opts.outPath))
        : await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(defaultOut),
          filters: wantCsv ? { 'CSV file': ['csv'] } : { 'QBO file': ['qbo'] },
          saveLabel: 'Save export',
        });
      if (!saveUri) return undefined;

      const written = [];
      const finalPrimary = uniquePath(saveUri.fsPath);
      if (wantCsv) {
        fs.writeFileSync(finalPrimary, buildCsv(parsed, path.basename(targetPath), { bom: useBom }), 'utf8');
        written.push(finalPrimary);
      }
      if (wantQbo) {
        const qboPath = wantCsv
          ? uniquePath(path.join(path.dirname(finalPrimary), `${path.basename(finalPrimary, path.extname(finalPrimary))}.qbo`))
          : finalPrimary;
        fs.writeFileSync(qboPath, buildQbo(parsed), 'utf8');
        written.push(qboPath);
      }
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(written[0]));
      await vscode.window.showTextDocument(doc, { preview: false });
      await pro.produced('exportCsvQbo');
      if (reach) reach.refresh();
      return { files: written, rows: parsed.stats.transactionCount };
    }

    // Batch folder mode
    const folderPath = isDir ? targetPath : path.dirname(targetPath);
    const qfxFiles = listQfxFilesInDir(folderPath);
    if (!qfxFiles.length) {
      vscode.window.showInformationMessage('No .qfx or .qbo files were found in this folder.');
      return undefined;
    }
    const outDirDefault = uniquePath(path.join(folderPath, 'qfx-export'));
    let outDir = opts.outDir ? uniquePath(opts.outDir) : outDirDefault;
    if (!opts.outDir) {
      const picked = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(outDirDefault, 'manifest.csv')),
        filters: { 'CSV manifest': ['csv'] },
        saveLabel: 'Create export folder here',
      });
      if (!picked) return undefined;
      outDir = path.dirname(picked.fsPath);
    }
    fs.mkdirSync(outDir, { recursive: true });

    const manifestLines = ['file,account,csv_file,qbo_file,rows,skipped_rows,errors'];
    const written = [];
    for (const f of qfxFiles) {
      const name = path.basename(f);
      const parsed = parseQfx(fs.readFileSync(f));
      const stem = path.basename(f, path.extname(f));
      let csvName = '';
      let qboName = '';
      if (wantCsv) {
        const outCsv = uniquePath(path.join(outDir, `${stem}.csv`));
        fs.writeFileSync(outCsv, buildCsv(parsed, name, { bom: useBom }), 'utf8');
        csvName = path.basename(outCsv);
        written.push(outCsv);
      }
      if (wantQbo) {
        const outQbo = uniquePath(path.join(outDir, `${stem}.qbo`));
        fs.writeFileSync(outQbo, buildQbo(parsed), 'utf8');
        qboName = path.basename(outQbo);
        written.push(outQbo);
      }
      manifestLines.push([
        name,
        parsed.account.accountId || '',
        csvName,
        qboName,
        String(parsed.stats.transactionCount),
        String(parsed.stats.malformedTxnCount),
        String(parsed.errors.length),
      ].map(csvCell).join(','));
    }
    const manifestPath = uniquePath(path.join(outDir, 'manifest.csv'));
    fs.writeFileSync(manifestPath, manifestLines.join('\n') + '\n', 'utf8');
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(manifestPath));
    await vscode.window.showTextDocument(doc, { preview: false });
    await pro.produced('exportCsvQbo');
    if (reach) reach.refresh();
    return { files: written, manifest: manifestPath };
  }

  async function validateStatement(uri, opts = {}) {
    if (!(await pro.allowed('validateStatement', opts))) return undefined;
    const target = await resolveTargetUri(uri, provider);
    if (!target) return undefined;

    const targetPath = target.fsPath;
    const isDir = target.scheme === 'file' && fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory();
    const files = isDir ? listQfxFilesInDir(targetPath) : [targetPath];
    if (!files.length) {
      vscode.window.showInformationMessage('No .qfx or .qbo files were found in this folder.');
      return undefined;
    }

    const entries = [];
    for (const f of files) {
      const buf = f === targetPath && target.scheme !== 'file'
        ? Buffer.from(await vscode.workspace.fs.readFile(target))
        : fs.readFileSync(f);
      entries.push({ fileName: path.basename(f), parsed: parseQfx(buf) });
    }
    const md = buildValidationMarkdown(entries);
    const doc = await vscode.workspace.openTextDocument({ content: md, language: 'markdown' });
    await vscode.window.showTextDocument(doc, { preview: false });
    await pro.produced('validateStatement');
    if (reach) reach.refresh();
    return { files: files.length, markdown: md };
  }

  return { exportCsvQbo, validateStatement };
}

module.exports = { createTools, uniquePath };
