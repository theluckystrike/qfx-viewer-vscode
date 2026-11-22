'use strict';
(function () {
  const api = acquireVsCodeApi();
  const app = document.getElementById('app');

  let state = {
    name: '',
    summary: null,
    pageSize: 100,
    tab: 'tx',
    from: 0,
    total: 0,
    rows: [],
    selected: -1,
    reqId: 0,
  };

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (const c of children) {
      if (c === null || c === undefined || c === false) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }

  function post(msg) {
    state.reqId += 1;
    api.postMessage({ ...msg, req: state.reqId });
    return state.reqId;
  }

  function fmtSize(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1048576).toFixed(1)} MB`;
  }

  function renderError(name, err) {
    app.innerHTML = '';
    app.appendChild(el('div', { id: 'error', class: 'error' },
      el('div', { class: 'title' }, el('span', { class: 'name', text: name })),
      el('p', { text: err }),
    ));
  }

  function renderShell() {
    const s = state.summary;
    const st = s.stats;
    const acc = s.account;
    const bal = s.balances;
    app.innerHTML = '';

    const chips = [
      ['Flavor', s.flavor || 'OFX'],
      ['Version', st.ofxVersion || 'n/a'],
      ['Transactions', String(st.transactionCount)],
      ['Credits', st.creditsFormatted],
      ['Debits', st.debitsFormatted],
      ['Net', st.netFormatted],
      ['Ledger', bal.ledger !== null ? `${bal.ledgerFormatted} ${acc.currency || ''}`.trim() : 'n/a'],
      ['Range', st.firstDate && st.lastDate ? `${st.firstDate} to ${st.lastDate}` : 'none'],
      ['Charset', s.encoding],
      ['Size', fmtSize(s.byteSize)],
    ];

    const summaryEl = el('div', { id: 'summary', class: 'summary' });
    for (const [k, v] of chips) {
      summaryEl.appendChild(el('span', { class: 'chip' }, el('b', { text: `${k} ` }), v));
    }
    if (s.signon.code && s.signon.code !== '0') {
      summaryEl.appendChild(el('span', { class: 'chip bad' }, el('b', { text: 'Signon ' }), `${s.signon.code} ${s.signon.severity}`));
    }
    if (s.duplicateFitids.length > 0) {
      summaryEl.appendChild(el('span', { class: 'chip warn' }, el('b', { text: 'Duplicate FITIDs ' }), String(s.duplicateFitids.length)));
    }
    if (s.errors.length > 0) {
      summaryEl.appendChild(el('span', { class: 'chip bad' }, el('b', { text: 'Errors ' }), String(s.errors.length)));
    }

    const accountsEl = el('div', { id: 'accounts', class: 'accounts' });
    if (acc.accountId || acc.bankId || acc.accountType) {
      accountsEl.appendChild(el('div', { class: 'acc-card' },
        el('span', { class: 'acc-name', text: acc.accountId ? `Account ${acc.accountId}` : '(Account)' }),
        acc.accountType ? el('span', { class: 'acc-type', text: acc.accountType }) : null,
        acc.bankId ? el('span', { class: 'muted', text: `Bank ${acc.bankId}` }) : null,
        acc.currency ? el('span', { class: 'muted', text: acc.currency }) : null,
        s.signon.org ? el('span', { class: 'muted', text: s.signon.org }) : null,
        bal.available !== null ? el('span', { text: `Available: ${bal.availableFormatted}` }) : null,
      ));
    }

    const warnContainer = el('div', { id: 'warnings' });
    const msgs = [...s.errors, ...s.warnings];
    if (msgs.length > 0) {
      warnContainer.appendChild(el('div', { class: 'warnstrip', text: msgs.slice(0, 3).join(' | ') }));
    }
    if (!s.ok && st.transactionCount === 0 && s.rawPreview && s.rawPreview.length > 0) {
      warnContainer.appendChild(el('pre', { class: 'raw-preview', text: s.rawPreview.join('\n') }));
    }

    const qInput = el('input', { id: 'q', type: 'search', placeholder: 'Filter payee, memo, FITID, amount or /regex/' });
    qInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyFilter(); });

    const typeSel = el('select', { id: 'typeFilter' }, el('option', { value: '', text: 'All types' }));
    for (const t of s.trnTypes) typeSel.appendChild(el('option', { value: t, text: t }));
    typeSel.addEventListener('change', applyFilter);

    const filterBtn = el('button', { id: 'filterBtn', text: 'Filter', onclick: applyFilter });
    const clearBtn = el('button', { id: 'clearBtn', text: 'Clear', onclick: () => { qInput.value = ''; typeSel.value = ''; applyFilter(); } });
    const checkBtn = el('button', { id: 'checkBtn', text: 'Check balances', onclick: () => post({ type: 'checkBalances' }) });

    const toolbar = el('div', { class: 'toolbar' },
      qInput,
      s.trnTypes.length > 0 ? typeSel : null,
      filterBtn,
      clearBtn,
      el('span', { class: 'sep' }),
      checkBtn,
      el('span', { id: 'protools' }),
    );

    const tabs = el('div', { class: 'tabs' },
      el('button', { id: 'tabTx', class: 'tab on', text: `Transactions (${st.transactionCount})`, onclick: () => switchTab('tx') }),
      el('button', { id: 'tabPayee', class: 'tab', text: `Payees (${s.payeeTotals.length})`, onclick: () => switchTab('payee') }),
      el('button', { id: 'tabRaw', class: 'tab', text: 'Raw OFX', onclick: () => switchTab('raw') }),
    );

    const top = el('div', { class: 'top' },
      el('div', { class: 'title' },
        el('span', { class: 'name', text: state.name }),
        el('span', { class: 'kind', text: 'QFX / OFX Statement' }),
      ),
      accountsEl.childNodes.length > 0 ? accountsEl : null,
      summaryEl,
      warnContainer,
      toolbar,
      tabs,
      el('div', { id: 'hint', class: 'hint' }),
    );

    const tableWrap = el('div', { id: 'tablewrap', class: 'tablewrap' },
      el('table', { id: 'grid' }, el('thead'), el('tbody')),
    );
    const detail = el('div', { id: 'detail', class: 'detail' },
      el('p', { class: 'muted', text: 'Select a transaction to inspect its OFX fields and FITID.' }),
    );
    const main = el('div', { class: 'main' }, tableWrap, detail);

    const pager = el('div', { class: 'pager' },
      el('button', { id: 'prevBtn', text: 'Prev', onclick: () => loadPage(Math.max(0, state.from - state.pageSize)) }),
      el('button', { id: 'nextBtn', text: 'Next', onclick: () => loadPage(state.from + state.pageSize) }),
      el('span', { id: 'range' }),
    );

    app.appendChild(top);
    app.appendChild(main);
    app.appendChild(pager);
  }

  function setHint(text) {
    const h = document.getElementById('hint');
    if (h) h.textContent = text || '';
  }

  function applyFilter() {
    const q = (document.getElementById('q') || {}).value || '';
    const type = (document.getElementById('typeFilter') || {}).value || '';
    state.from = 0;
    post({ type: 'filter', filter: { text: q, type } });
  }

  function loadPage(from) {
    state.from = from;
    post({ type: 'page', from, n: state.pageSize });
  }

  function switchTab(tab) {
    state.tab = tab;
    for (const [id, t] of [['tabTx', 'tx'], ['tabPayee', 'payee'], ['tabRaw', 'raw']]) {
      const b = document.getElementById(id);
      if (b) b.classList.toggle('on', tab === t);
    }
    const wrap = document.getElementById('tablewrap');
    if (!wrap) return;
    if (tab === 'raw') {
      wrap.innerHTML = '';
      wrap.appendChild(el('pre', { class: 'raw-ofx', text: state.summary.prettyOfx || '' }));
      const range = document.getElementById('range');
      if (range) range.textContent = 'Pretty-printed raw OFX tags';
      return;
    }
    if (!document.getElementById('grid')) {
      wrap.innerHTML = '';
      wrap.appendChild(el('table', { id: 'grid' }, el('thead'), el('tbody')));
    }
    if (tab === 'tx') renderTxTable();
    else renderPayeeTable();
  }

  function renderPayeeTable() {
    const thead = document.querySelector('#grid thead');
    const tbody = document.querySelector('#grid tbody');
    if (!thead || !tbody) return;
    thead.innerHTML = '';
    tbody.innerHTML = '';
    thead.appendChild(el('tr', null,
      el('th', { text: 'Payee' }),
      el('th', { class: 'num', text: 'Count' }),
      el('th', { class: 'num', text: 'Total' }),
    ));
    for (const item of state.summary.payeeTotals) {
      const amtCls = item.total < 0 ? 'num neg' : 'num pos';
      tbody.appendChild(el('tr', null,
        el('td', { text: item.payee }),
        el('td', { class: 'num', text: String(item.count) }),
        el('td', { class: amtCls, text: item.totalFormatted }),
      ));
    }
    const range = document.getElementById('range');
    if (range) range.textContent = `${state.summary.payeeTotals.length} payees`;
  }

  function renderTxTable() {
    const thead = document.querySelector('#grid thead');
    const tbody = document.querySelector('#grid tbody');
    if (!thead || !tbody) return;
    thead.innerHTML = '';
    tbody.innerHTML = '';

    const cols = ['Date', 'Type', 'Name', 'Memo', 'Amount', 'Balance', 'FITID'];
    const trHead = el('tr');
    for (const c of cols) {
      trHead.appendChild(el('th', { class: (c === 'Amount' || c === 'Balance') ? 'num' : '', text: c }));
    }
    thead.appendChild(trHead);

    for (const r of state.rows) {
      const amtCls = r.amount < 0 ? 'num neg' : 'num pos';
      const tr = el('tr', { class: r.index === state.selected ? 'sel' : '', onclick: () => selectRow(r.index) },
        el('td', { text: r.date }),
        el('td', { text: r.type }),
        el('td', { text: r.name }),
        el('td', { text: r.memo }),
        el('td', { class: amtCls, text: r.amountFormatted }),
        el('td', { class: 'num', text: r.runningFormatted }),
        el('td', { class: 'muted', text: r.fitid }),
      );
      tbody.appendChild(tr);
    }

    const range = document.getElementById('range');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const start = state.total ? state.from + 1 : 0;
    const end = Math.min(state.from + state.rows.length, state.total);
    if (range) range.textContent = state.total ? `${start} to ${end} of ${state.total}` : '0 transactions';
    if (prevBtn) prevBtn.disabled = state.from <= 0;
    if (nextBtn) nextBtn.disabled = end >= state.total;
  }

  function selectRow(index) {
    state.selected = index;
    if (state.tab === 'tx') renderTxTable();
    post({ type: 'detail', index });
  }

  function renderDetail(d) {
    const pane = document.getElementById('detail');
    if (!pane) return;
    pane.innerHTML = '';
    if (!d) {
      pane.appendChild(el('p', { class: 'muted', text: 'No transaction selected.' }));
      return;
    }
    pane.appendChild(el('div', { class: 'dhead' },
      el('strong', { text: d.name || `Transaction #${d.index + 1}` }),
      el('span', { class: 'muted', text: d.type || '' }),
    ));
    const fields = [
      ['Date', d.date ? `${d.date} (raw: ${d.dtPostedRaw})` : d.dtPostedRaw],
      ['Amount', d.amountFormatted],
      ['Running balance', d.runningFormatted],
      ['FITID', d.fitid || '(none)'],
      ['Memo', d.memo || '(none)'],
      ['Check No.', d.checkNum || '(none)'],
      ['Ref No.', d.refNum || '(none)'],
      ['SIC', d.sic || '(none)'],
      ['Row key', d.rowKey],
    ];
    for (const [k, v] of fields) {
      pane.appendChild(el('div', { class: 'meta' }, el('strong', { text: `${k}: ` }), v));
    }
  }

  function showAlso(html, anchorId) {
    document.querySelectorAll('.zovo-also').forEach((n) => n.remove());
    if (!html) return;
    const anchor = anchorId ? document.getElementById(anchorId) : null;
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const node = tpl.content.firstElementChild;
    if (!node) return;
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(node, anchor.nextSibling);
    else {
      const hint = document.getElementById('hint');
      if (hint) hint.appendChild(node);
    }
  }

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || typeof m !== 'object') return;
    switch (m.type) {
      case 'init':
        state.name = m.name || '';
        if (m.error) { renderError(state.name, m.error); return; }
        state.summary = m.summary;
        state.pageSize = m.pageSize || 100;
        state.from = 0;
        state.selected = -1;
        renderShell();
        loadPage(0);
        return;
      case 'pageResult':
        state.from = m.from;
        state.total = m.total;
        state.rows = m.rows || [];
        if (state.tab === 'tx') renderTxTable();
        return;
      case 'filterResult':
        state.total = m.count;
        setHint(`${m.count} of ${m.total} transactions match.`);
        loadPage(0);
        return;
      case 'detailResult':
        renderDetail(m.detail);
        return;
      case 'checkBalancesResult':
        setHint(`Checked ${m.total} transactions: net ${m.net}, ledger ${m.ledger || 'n/a'}, ${m.duplicates} duplicate FITIDs, ${m.errors} errors.`);
        return;
      case 'zovoAlso':
        showAlso(m.html, m.anchor);
        return;
      case 'hint':
        setHint(m.text);
        return;
      default:
    }
  });

  post({ type: 'ready' });
})();
