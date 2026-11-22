'use strict';
// REACH1/REACH2: Pro tools for the viewer toolbar row, Explorer/editor menus and the quiet "Also:" line.
module.exports = {
  prefix: 'zovoQfx',
  triesKey: 'zovoQfx.proTrial',
  slot: '#protools',
  tools: [
    { id: 'exportCsvQbo', title: 'Export statement to CSV and QBO', command: 'zovoQfx.exportCsvQbo' },
    { id: 'validateStatement', title: 'Validate statement balances and FITIDs', command: 'zovoQfx.validateStatement' },
  ],
};
