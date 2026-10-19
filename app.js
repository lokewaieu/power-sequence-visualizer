/**
 * Power Sequence Visualizer & Drafter
 * Lightweight, zero-dependency interactive timing diagram tool.
 */

(function () {
  'use strict';

  // --- Constants & Config ---
  const STORAGE_KEY = 'pwr_seq_visualizer_data_v2';
  const SVG_VIEW_WIDTH = 1000;
  const SVG_VIEW_HEIGHT = 100;
  const LOW_Y = 75;
  const HIGH_Y = 25;
  const SLEW_DX = 8; // Transition edge slope in SVG units

  // --- 7 Distinct Waveform Color Choices ---
  const WAVEFORM_COLORS = [
    { id: 'cyan', name: 'Cyan (Default)', hex: '#00e5ff' },
    { id: 'emerald', name: 'Emerald Green', hex: '#10b981' },
    { id: 'amber', name: 'Amber Gold', hex: '#f59e0b' },
    { id: 'rose', name: 'Rose Red', hex: '#f43f5e' },
    { id: 'purple', name: 'Purple Violet', hex: '#a855f7' },
    { id: 'blue', name: 'Electric Blue', hex: '#3b82f6' },
    { id: 'orange', name: 'Coral Orange', hex: '#f97316' }
  ];

  // Helper to escape XML/SVG special characters (fixes xmlParseEntityRef errors)
  function escapeXml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function getRowColor(row, index) {
    if (row && row.color) return row.color;
    if (index !== undefined && index >= 0) {
      return WAVEFORM_COLORS[index % WAVEFORM_COLORS.length].hex;
    }
    return WAVEFORM_COLORS[0].hex;
  }

  function hexToRgba(hex, alpha) {
    if (!hex) return `rgba(0, 229, 255, ${alpha})`;
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    if (isNaN(num)) return `rgba(0, 229, 255, ${alpha})`;
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // --- Initial Default Sample Data (Real-world SoC Power Tree) ---
  const DEFAULT_SAMPLE_DATA = [
    {
      id: 'row_1',
      source: 'Main Adapter',
      destination: 'PMIC / Board',
      signalName: 'VIN_12V',
      voltage: '12.0V',
      mode: 'high',
      edge1: 0.05,
      edge2: 0.90,
      color: '#00e5ff'
    },
    {
      id: 'row_2',
      source: 'PMIC Buck 1',
      destination: 'Regulators & USB',
      signalName: 'VCC_5V0',
      voltage: '5.0V',
      mode: 'rising',
      edge1: 0.15,
      edge2: 0.85,
      color: '#10b981'
    },
    {
      id: 'row_3',
      source: 'PMIC Buck 2',
      destination: 'SoC I/O & Periph',
      signalName: 'VDD_3V3',
      voltage: '3.3V',
      mode: 'rising',
      edge1: 0.30,
      edge2: 0.85,
      color: '#f59e0b'
    },
    {
      id: 'row_4',
      source: 'PMIC LDO 1',
      destination: 'SoC Analog & DDR',
      signalName: 'VDD_1V8',
      voltage: '1.8V',
      mode: 'rising',
      edge1: 0.45,
      edge2: 0.85,
      color: '#f43f5e'
    },
    {
      id: 'row_5',
      source: 'PMIC Buck 3',
      destination: 'SoC CPU Core',
      signalName: 'VDD_CORE',
      voltage: '0.9V',
      mode: 'rising',
      edge1: 0.65,
      edge2: 0.85,
      color: '#a855f7'
    },
    {
      id: 'row_6',
      source: 'Oscillator',
      destination: 'SoC Ref Clock',
      signalName: 'CLK_VALID',
      voltage: '1.8V',
      mode: 'clock',
      edge1: 0.15,
      edge2: 0.90,
      color: '#3b82f6'
    },
    {
      id: 'row_7',
      source: 'MCU Supervisor',
      destination: 'SoC Reset Pin',
      signalName: 'SYS_RESET_N',
      voltage: '3.3V',
      mode: 'rising',
      edge1: 0.90,
      edge2: 0.95,
      color: '#f97316'
    }
  ];

  // --- Application State ---
  const state = {
    appMode: 'advanced', // 'basic' | 'advanced'
    rows: [],
    timeUnit: 'ms',
    maxTime: 100,
    hideVoltage: false,
    hideType: false,
    snapGrid: true,
    theme: 'dark',
    colWidths: {
      source: 140,
      dest: 140,
      signal: 170,
      voltage: 105
    }
  };

  // Active Edge Dragging State
  let activeDragInfo = null;

  // Active Row Dragging State
  let activeRowDrag = null;

  // Active Column Resizing State
  let activeColResize = null;

  // DOM Elements Cache
  const tbody = document.getElementById('sequence-tbody');
  const sequenceTable = document.getElementById('sequence-table');
  const rulerEl = document.getElementById('timeline-ruler');
  const rowCountBadge = document.getElementById('row-count-badge');
  const emptyStateEl = document.getElementById('empty-state');
  const toggleVoltageBtn = document.getElementById('toggle-voltage-btn');
  const voltageToggleLabel = document.getElementById('voltage-toggle-label');
  const toggleTypeBtn = document.getElementById('toggle-type-btn');
  const typeToggleLabel = document.getElementById('type-toggle-label');
  const timeUnitSelect = document.getElementById('time-unit-select');
  const maxTimeInput = document.getElementById('max-time-input');
  const snapGridCheckbox = document.getElementById('snap-grid-checkbox');
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  const exportDropdownBtn = document.getElementById('export-dropdown-btn');
  const exportMenu = document.getElementById('export-menu');
  const colorDropdownBtn = document.getElementById('color-dropdown-btn');
  const colorMenu = document.getElementById('color-menu');
  const paletteSwatchesAll = document.getElementById('palette-swatches-all');
  const colorMultiBtn = document.getElementById('color-multi-btn');
  const rowColorPopover = document.getElementById('row-color-popover');
  const popoverSwatchesEl = document.getElementById('popover-swatches');
  const crosshairGuide = document.getElementById('crosshair-guide');
  const crosshairBadge = document.getElementById('crosshair-badge');
  const dragTooltip = document.getElementById('drag-tooltip');
  const tableScrollWrapper = document.getElementById('table-scroll-wrapper');
  const saveStatusText = document.getElementById('save-status-text');
  const dragRowGhost = document.getElementById('drag-row-ghost');
  const modeBtnBasic = document.getElementById('mode-btn-basic');
  const modeBtnAdvanced = document.getElementById('mode-btn-advanced');
  const footerModeLabel = document.getElementById('footer-mode-label');

  // --- Initialization ---
  function init() {
    loadSavedState();
    setupEventListeners();
    setupGlobalPointerListeners();
    setupColumnResizing();
    renderAll();
  }

  // --- State Persistence ---
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if (saveStatusText) {
        saveStatusText.textContent = 'Draft auto-saved';
        setTimeout(() => {
          if (saveStatusText) saveStatusText.textContent = 'Draft saved to browser storage';
        }, 1500);
      }
    } catch (e) {
      console.warn('Could not save to localStorage', e);
    }
  }

  function loadSavedState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        state.appMode = parsed.appMode || 'advanced';
        state.rows = Array.isArray(parsed.rows) ? parsed.rows : DEFAULT_SAMPLE_DATA;
        state.timeUnit = parsed.timeUnit || 'ms';
        state.maxTime = parsed.maxTime !== undefined ? parsed.maxTime : 100;
        state.hideVoltage = !!parsed.hideVoltage;
        state.hideType = !!parsed.hideType;
        state.snapGrid = parsed.snapGrid !== undefined ? parsed.snapGrid : true;
        state.theme = parsed.theme || 'dark';
        if (parsed.colWidths) {
          state.colWidths = Object.assign({}, state.colWidths, parsed.colWidths);
        }
      } else {
        state.rows = JSON.parse(JSON.stringify(DEFAULT_SAMPLE_DATA));
      }
    } catch (e) {
      console.warn('Error reading localStorage, reverting to sample data', e);
      state.rows = JSON.parse(JSON.stringify(DEFAULT_SAMPLE_DATA));
    }

    // Apply UI state
    timeUnitSelect.value = state.timeUnit;
    maxTimeInput.value = state.maxTime;
    snapGridCheckbox.checked = state.snapGrid;
    applyAppMode();
    applyVoltageColumnVisibility();
    applyTypeColumnVisibility();
    applyTheme();
    applyColumnWidths();
  }

  // --- Basic vs Advanced Mode Management ---
  function setAppMode(mode) {
    state.appMode = mode;
    applyAppMode();
    saveState();
    renderTimelineRuler();
    renderAllRowWaveforms();
  }

  function applyAppMode() {
    if (state.appMode === 'basic') {
      document.body.classList.remove('mode-advanced');
      document.body.classList.add('mode-basic');
      modeBtnBasic.classList.add('active');
      modeBtnAdvanced.classList.remove('active');
      if (footerModeLabel) {
        footerModeLabel.textContent = '⚡ Basic Mode: Clean Waveforms Without Numbers or Units';
      }
    } else {
      document.body.classList.remove('mode-basic');
      document.body.classList.add('mode-advanced');
      modeBtnAdvanced.classList.add('active');
      modeBtnBasic.classList.remove('active');
      if (footerModeLabel) {
        footerModeLabel.textContent = '⚡ Advanced Mode: Full Precision Timing & Logic Levels';
      }
    }
  }

  // --- Theme Management ---
  function applyTheme() {
    if (state.theme === 'light') {
      document.body.classList.remove('theme-dark');
      document.body.classList.add('theme-light');
    } else {
      document.body.classList.remove('theme-light');
      document.body.classList.add('theme-dark');
    }
  }

  function toggleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
    saveState();
  }

  // --- Column Visibility Management ---
  function applyVoltageColumnVisibility() {
    if (state.hideVoltage) {
      document.body.classList.add('hide-voltage');
      voltageToggleLabel.textContent = 'Show Voltage';
    } else {
      document.body.classList.remove('hide-voltage');
      voltageToggleLabel.textContent = 'Hide Voltage';
    }
  }

  function toggleVoltageColumn() {
    state.hideVoltage = !state.hideVoltage;
    applyVoltageColumnVisibility();
    saveState();
  }

  function applyTypeColumnVisibility() {
    if (state.hideType) {
      document.body.classList.add('hide-type');
      typeToggleLabel.textContent = 'Show Type';
    } else {
      document.body.classList.remove('hide-type');
      typeToggleLabel.textContent = 'Hide Type';
    }
  }

  function toggleTypeColumn() {
    state.hideType = !state.hideType;
    applyTypeColumnVisibility();
    saveState();
  }

  // --- Column Widths Management ---
  function applyColumnWidths() {
    for (const [colKey, width] of Object.entries(state.colWidths)) {
      const th = document.querySelector(`th[data-col="${colKey}"]`);
      if (th && width) {
        th.style.width = width + 'px';
      }
    }
  }

  function setupColumnResizing() {
    const resizers = document.querySelectorAll('.col-resizer');
    resizers.forEach((resizer) => {
      resizer.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();

        const th = resizer.closest('th');
        if (!th) return;

        const colKey = th.dataset.col;
        const startX = e.clientX;
        const startWidth = th.offsetWidth;

        resizer.classList.add('is-resizing');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        activeColResize = {
          th,
          colKey,
          startX,
          startWidth,
          resizer
        };
      });
    });
  }

  function handleColResizeMove(e) {
    if (!activeColResize) return;

    const { th, colKey, startX, startWidth } = activeColResize;
    const delta = e.clientX - startX;
    const minWidth = 75;
    const newWidth = Math.max(minWidth, startWidth + delta);

    th.style.width = `${newWidth}px`;
    state.colWidths[colKey] = newWidth;
  }

  function handleColResizeEnd() {
    if (!activeColResize) return;

    activeColResize.resizer.classList.remove('is-resizing');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    activeColResize = null;
    saveState();
  }

  // --- Time Scale Ruler Rendering ---
  function renderTimelineRuler() {
    if (!rulerEl) return;
    rulerEl.innerHTML = '';

    const divisions = 10;
    const isBasic = state.appMode === 'basic';

    for (let i = 0; i <= divisions; i++) {
      const fraction = i / divisions;
      const leftPct = (fraction * 100).toFixed(1);
      
      const tick = document.createElement('div');
      tick.className = 'ruler-tick';
      tick.style.left = `${leftPct}%`;

      // In Basic mode: no numbers or units! In Advanced: show numbers and unit
      if (!isBasic) {
        const timeVal = (fraction * state.maxTime).toFixed(fraction === 0 || fraction === 1 ? 0 : 1);
        const label = document.createElement('span');
        label.className = 'ruler-tick-label';
        label.textContent = `${timeVal}${state.timeUnit}`;
        tick.appendChild(label);
      }

      rulerEl.appendChild(tick);

      // Minor tick halfway (5%)
      if (i < divisions) {
        const minorTick = document.createElement('div');
        minorTick.className = 'ruler-tick minor';
        minorTick.style.left = `${(fraction + 0.05) * 100}%`;
        rulerEl.appendChild(minorTick);
      }
    }
  }

  function formatTime(fraction) {
    const timeVal = (fraction * state.maxTime).toFixed(1);
    const pctVal = Math.round(fraction * 100);
    return `${timeVal} ${state.timeUnit} (${pctVal}%)`;
  }

  // --- SVG Waveform Generation ---
  function createWaveformSvg(row, index) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${SVG_VIEW_WIDTH} ${SVG_VIEW_HEIGHT}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.classList.add('waveform-svg');
    svg.dataset.rowIndex = index;

    // Background Grid lines (at 10% intervals)
    for (let i = 10; i < 100; i += 10) {
      const x = (i / 100) * SVG_VIEW_WIDTH;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x);
      line.setAttribute('y1', 0);
      line.setAttribute('x2', x);
      line.setAttribute('y2', SVG_VIEW_HEIGHT);
      line.setAttribute('class', i % 20 === 0 ? 'wf-grid-major' : 'wf-grid-line');
      svg.appendChild(line);
    }

    // Subtle reference levels for 0 (LOW) and 1 (HIGH)
    const lowRef = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    lowRef.setAttribute('x1', 0);
    lowRef.setAttribute('y1', LOW_Y);
    lowRef.setAttribute('x2', SVG_VIEW_WIDTH);
    lowRef.setAttribute('y2', LOW_Y);
    lowRef.setAttribute('class', 'wf-low-ref');
    svg.appendChild(lowRef);

    const highRef = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    highRef.setAttribute('x1', 0);
    highRef.setAttribute('y1', HIGH_Y);
    highRef.setAttribute('x2', SVG_VIEW_WIDTH);
    highRef.setAttribute('y2', HIGH_Y);
    highRef.setAttribute('class', 'wf-high-ref');
    svg.appendChild(highRef);

    // Waveform Fill Path
    const rowColor = getRowColor(row, index);
    const rowBg = hexToRgba(rowColor, 0.15);
    const rowGlow = hexToRgba(rowColor, 0.35);

    const fillPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    fillPath.setAttribute('class', 'wf-fill');
    fillPath.style.fill = rowBg;
    svg.appendChild(fillPath);

    // Waveform Trace Path
    const tracePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tracePath.setAttribute('class', 'wf-trace');
    tracePath.style.stroke = rowColor;
    tracePath.style.filter = `drop-shadow(0 0 4px ${rowGlow})`;
    svg.appendChild(tracePath);

    // Update geometry according to row mode
    updateWaveformGeometry(row, tracePath, fillPath);

    return svg;
  }

  // Update SVG Path attributes
  function updateWaveformGeometry(row, tracePath, fillPath) {
    const { mode } = row;
    const edge1 = row.edge1 !== undefined ? row.edge1 : 0.25;
    const edge2 = row.edge2 !== undefined ? row.edge2 : 0.75;
    let traceD = '';
    let fillD = '';

    if (mode === 'low') {
      traceD = `M 0 ${LOW_Y} L ${SVG_VIEW_WIDTH} ${LOW_Y}`;
      fillD = '';
    } else if (mode === 'high') {
      traceD = `M 0 ${HIGH_Y} L ${SVG_VIEW_WIDTH} ${HIGH_Y}`;
      fillD = `M 0 ${HIGH_Y} L ${SVG_VIEW_WIDTH} ${HIGH_Y} L ${SVG_VIEW_WIDTH} ${LOW_Y} L 0 ${LOW_Y} Z`;
    } else if (mode === 'rising') {
      const x = Math.max(0, Math.min(SVG_VIEW_WIDTH, edge1 * SVG_VIEW_WIDTH));
      const x0 = Math.max(0, x - SLEW_DX);
      const x1 = Math.min(SVG_VIEW_WIDTH, x + SLEW_DX);

      traceD = `M 0 ${LOW_Y} L ${x0} ${LOW_Y} L ${x1} ${HIGH_Y} L ${SVG_VIEW_WIDTH} ${HIGH_Y}`;
      fillD = `M ${x0} ${LOW_Y} L ${x1} ${HIGH_Y} L ${SVG_VIEW_WIDTH} ${HIGH_Y} L ${SVG_VIEW_WIDTH} ${LOW_Y} Z`;
    } else if (mode === 'falling') {
      const x = Math.max(0, Math.min(SVG_VIEW_WIDTH, edge1 * SVG_VIEW_WIDTH));
      const x0 = Math.max(0, x - SLEW_DX);
      const x1 = Math.min(SVG_VIEW_WIDTH, x + SLEW_DX);

      traceD = `M 0 ${HIGH_Y} L ${x0} ${HIGH_Y} L ${x1} ${LOW_Y} L ${SVG_VIEW_WIDTH} ${LOW_Y}`;
      fillD = `M 0 ${HIGH_Y} L ${x0} ${HIGH_Y} L ${x1} ${LOW_Y} L 0 ${LOW_Y} Z`;
    } else if (mode === 'pulse') {
      const eA = Math.min(edge1, edge2);
      const eB = Math.max(edge1, edge2);

      const xA = Math.max(0, Math.min(SVG_VIEW_WIDTH, eA * SVG_VIEW_WIDTH));
      const xA0 = Math.max(0, xA - SLEW_DX);
      const xA1 = Math.min(SVG_VIEW_WIDTH, xA + SLEW_DX);

      const xB = Math.max(0, Math.min(SVG_VIEW_WIDTH, eB * SVG_VIEW_WIDTH));
      const xB0 = Math.max(0, xB - SLEW_DX);
      const xB1 = Math.min(SVG_VIEW_WIDTH, xB + SLEW_DX);

      traceD = `M 0 ${LOW_Y} L ${xA0} ${LOW_Y} L ${xA1} ${HIGH_Y} L ${xB0} ${HIGH_Y} L ${xB1} ${LOW_Y} L ${SVG_VIEW_WIDTH} ${LOW_Y}`;
      fillD = `M ${xA0} ${LOW_Y} L ${xA1} ${HIGH_Y} L ${xB0} ${HIGH_Y} L ${xB1} ${LOW_Y} Z`;
    } else if (mode === 'pulse_low') {
      const eA = Math.min(edge1, edge2);
      const eB = Math.max(edge1, edge2);

      const xA = Math.max(0, Math.min(SVG_VIEW_WIDTH, eA * SVG_VIEW_WIDTH));
      const xA0 = Math.max(0, xA - SLEW_DX);
      const xA1 = Math.min(SVG_VIEW_WIDTH, xA + SLEW_DX);

      const xB = Math.max(0, Math.min(SVG_VIEW_WIDTH, eB * SVG_VIEW_WIDTH));
      const xB0 = Math.max(0, xB - SLEW_DX);
      const xB1 = Math.min(SVG_VIEW_WIDTH, xB + SLEW_DX);

      traceD = `M 0 ${HIGH_Y} L ${xA0} ${HIGH_Y} L ${xA1} ${LOW_Y} L ${xB0} ${LOW_Y} L ${xB1} ${HIGH_Y} L ${SVG_VIEW_WIDTH} ${HIGH_Y}`;
      fillD = `M 0 ${HIGH_Y} L ${xA0} ${HIGH_Y} L ${xA1} ${LOW_Y} L 0 ${LOW_Y} Z M ${xB0} ${LOW_Y} L ${xB1} ${HIGH_Y} L ${SVG_VIEW_WIDTH} ${HIGH_Y} L ${SVG_VIEW_WIDTH} ${LOW_Y} Z`;
    } else if (mode === 'clock') {
      // Gated 50% duty cycle square wave at double frequency (period = 50 units, 20 cycles across 1000 units)
      // Draggable edge sliders define when the clock starts (edge1) and stops (edge2)
      const eA = Math.min(edge1 !== undefined ? edge1 : 0.10, edge2 !== undefined ? edge2 : 0.90);
      const eB = Math.max(edge1 !== undefined ? edge1 : 0.10, edge2 !== undefined ? edge2 : 0.90);

      const xA = Math.max(0, Math.min(SVG_VIEW_WIDTH, eA * SVG_VIEW_WIDTH));
      const xB = Math.max(0, Math.min(SVG_VIEW_WIDTH, eB * SVG_VIEW_WIDTH));

      const period = 50; // Double frequency: period is 50 units (25 HIGH, 25 LOW)
      const halfPeriod = 25;

      let dTrace = `M 0 ${LOW_Y} L ${xA} ${LOW_Y}`;
      let dFill = '';
      let curX = xA;

      while (curX < xB) {
        const highEnd = Math.min(xB, curX + halfPeriod);
        dTrace += ` L ${curX} ${HIGH_Y} L ${highEnd} ${HIGH_Y}`;
        dFill += `M ${curX} ${LOW_Y} L ${curX} ${HIGH_Y} L ${highEnd} ${HIGH_Y} L ${highEnd} ${LOW_Y} Z `;

        if (highEnd >= xB) {
          dTrace += ` L ${xB} ${LOW_Y}`;
          break;
        }

        const lowEnd = Math.min(xB, curX + period);
        dTrace += ` L ${highEnd} ${LOW_Y} L ${lowEnd} ${LOW_Y}`;
        curX = lowEnd;
      }

      dTrace += ` L ${SVG_VIEW_WIDTH} ${LOW_Y}`;
      traceD = dTrace;
      fillD = dFill;
    }

    tracePath.setAttribute('d', traceD);
    fillPath.setAttribute('d', fillD);
  }

  // Create HTML Draggable Edge Handle Overlay (Guaranteed 100% True Round Circular Dot)
  function createEdgeMarkerEl(row, rowIndex, edgeNum, fraction) {
    const rowColor = getRowColor(row, rowIndex);
    const wrap = document.createElement('div');
    wrap.className = 'wf-edge-marker-wrap';
    wrap.dataset.rowIndex = rowIndex;
    wrap.dataset.edgeNum = edgeNum;
    wrap.style.left = `${(fraction * 100).toFixed(2)}%`;

    const line = document.createElement('div');
    line.className = 'wf-edge-line';
    line.style.borderLeftColor = hexToRgba(rowColor, 0.85);
    wrap.appendChild(line);

    const dot = document.createElement('div');
    dot.className = 'wf-edge-dot';
    dot.style.backgroundColor = rowColor;
    dot.style.boxShadow = `0 0 6px ${hexToRgba(rowColor, 0.5)}`;
    wrap.appendChild(dot);

    const label = document.createElement('div');
    label.className = 'wf-edge-label';
    label.style.color = rowColor;
    label.textContent = `${(fraction * state.maxTime).toFixed(1)}`;
    wrap.appendChild(label);

    wrap.addEventListener('pointerdown', (e) => startEdgeDrag(e, rowIndex, edgeNum, wrap));

    return wrap;
  }

  // Populate waveform container with SVG trace and HTML dot markers
  function populateWaveformContainer(container, row, index) {
    container.innerHTML = '';
    const svg = createWaveformSvg(row, index);
    container.appendChild(svg);

    // Draggable edge HTML overlay handles (True circular dots)
    if (row.mode === 'rising' || row.mode === 'falling') {
      const marker = createEdgeMarkerEl(row, index, 1, row.edge1 !== undefined ? row.edge1 : 0.25);
      container.appendChild(marker);
    } else if (row.mode === 'pulse' || row.mode === 'pulse_low' || row.mode === 'clock') {
      const defaultE1 = row.mode === 'clock' ? 0.10 : 0.25;
      const defaultE2 = row.mode === 'clock' ? 0.90 : 0.75;
      const marker1 = createEdgeMarkerEl(row, index, 1, row.edge1 !== undefined ? row.edge1 : defaultE1);
      const marker2 = createEdgeMarkerEl(row, index, 2, row.edge2 !== undefined ? row.edge2 : defaultE2);
      container.appendChild(marker1);
      container.appendChild(marker2);
    }
  }

  // --- Edge Dragging Mechanics with Exact Cursor Tracking ---
  function startEdgeDrag(e, rowIndex, edgeNum, markerWrap) {
    e.stopPropagation();
    e.preventDefault();

    const row = state.rows[rowIndex];
    if (!row) return;

    const container = markerWrap.closest('.waveform-cell-container');
    const svg = container ? container.querySelector('.waveform-svg') : null;
    if (!svg) return;

    // Requirement 3: Gather edge positions from all other rows for magnetic snapping
    const otherEdges = [];
    state.rows.forEach((r, rIdx) => {
      if (rIdx === rowIndex) return;
      if (r.mode === 'rising' || r.mode === 'falling') {
        if (r.edge1 !== undefined) {
          otherEdges.push({
            edge: r.edge1,
            signalName: r.signalName || ('Signal #' + (rIdx + 1))
          });
        }
      } else if (r.mode === 'pulse' || r.mode === 'pulse_low' || r.mode === 'clock') {
        const startSuffix = r.mode === 'clock' ? ' (Clock Start)' : ' (Start)';
        const endSuffix = r.mode === 'clock' ? ' (Clock Stop)' : ' (End)';
        if (r.edge1 !== undefined) {
          otherEdges.push({
            edge: r.edge1,
            signalName: (r.signalName || 'Signal') + startSuffix
          });
        }
        if (r.edge2 !== undefined) {
          otherEdges.push({
            edge: r.edge2,
            signalName: (r.signalName || 'Signal') + endSuffix
          });
        }
      }
    });

    activeDragInfo = {
      rowIndex,
      edgeNum,
      row,
      container,
      markerWrap,
      svg,
      otherEdges
    };

    markerWrap.classList.add('dragging');

    // Update and display synchronized vertical crosshair guideline immediately
    const edgeFrac = edgeNum === 1 ? row.edge1 : row.edge2;
    const initialFrac = edgeFrac !== undefined ? edgeFrac : 0.25;
    const rect = container.getBoundingClientRect();
    updateCrosshairGuide(rect.left + initialFrac * rect.width, container, initialFrac);

    if (state.appMode === 'advanced') {
      dragTooltip.classList.remove('hidden');
      updateDragTooltip(e, initialFrac);
    }

    document.body.style.cursor = 'ew-resize';
  }

  function handleEdgeDragMove(e) {
    if (!activeDragInfo) return;

    const { edgeNum, row, container, markerWrap, svg, otherEdges } = activeDragInfo;
    const rect = container.getBoundingClientRect();
    
    // Pixel-perfect fractional calculation against container width
    let fraction = (e.clientX - rect.left) / rect.width;
    fraction = Math.max(0, Math.min(1, fraction));

    // Requirement 1: Snap threshold reduced to half of what it was (0.008 = 0.8% magnetic snap radius)
    let snappedTarget = null;
    if (!e.shiftKey && otherEdges && otherEdges.length > 0) {
      const snapThreshold = 0.008;
      let minDiff = Infinity;
      for (const target of otherEdges) {
        const diff = Math.abs(fraction - target.edge);
        if (diff <= snapThreshold && diff < minDiff) {
          minDiff = diff;
          snappedTarget = target;
        }
      }
    }

    if (snappedTarget) {
      fraction = snappedTarget.edge;
      markerWrap.classList.add('is-snapped');
    } else {
      markerWrap.classList.remove('is-snapped');
      // If not snapped to another rail, snap to 5% grid if enabled
      if (state.snapGrid && !e.shiftKey) {
        const snapStep = 0.05;
        fraction = Math.round(fraction / snapStep) * snapStep;
        fraction = Math.max(0, Math.min(1, fraction));
      }
    }

    // Update row state
    if (edgeNum === 1) {
      row.edge1 = fraction;
    } else {
      row.edge2 = fraction;
    }

    // Live update marker element position
    markerWrap.style.left = (fraction * 100).toFixed(2) + '%';

    const label = markerWrap.querySelector('.wf-edge-label');
    if (label) {
      label.textContent = (fraction * state.maxTime).toFixed(1);
    }

    // Live update trace & fill paths in SVG
    const tracePath = svg.querySelector('.wf-trace');
    const fillPath = svg.querySelector('.wf-fill');
    if (tracePath && fillPath) {
      updateWaveformGeometry(row, tracePath, fillPath);
    }

    // Requirement 2: Global vertical guide line follows cursor/marker continuously during drag
    const crosshairX = rect.left + fraction * rect.width;
    updateCrosshairGuide(crosshairX, container, fraction);

    // Update tooltip
    if (state.appMode === 'advanced') {
      let tooltipText = formatTime(fraction);
      if (snappedTarget) {
        tooltipText += ' • 🧲 Snapped to ' + snappedTarget.signalName;
      }
      dragTooltip.textContent = tooltipText;
      dragTooltip.style.left = e.clientX + 'px';
      dragTooltip.style.top = e.clientY + 'px';
    }
  }

  function handleEdgeDragEnd(e) {
    if (!activeDragInfo) return;

    if (activeDragInfo.markerWrap) {
      activeDragInfo.markerWrap.classList.remove('dragging', 'is-snapped');
    }

    activeDragInfo = null;
    dragTooltip.classList.add('hidden');
    document.body.style.cursor = '';
    saveState();

    if (e) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const container = el ? el.closest('.waveform-cell-container') : null;
      if (container) {
        updateCrosshairGuide(e.clientX, container);
      } else {
        crosshairGuide.classList.add('hidden');
      }
    } else {
      crosshairGuide.classList.add('hidden');
    }
  }

  function updateDragTooltip(e, fraction) {
    dragTooltip.style.left = `${e.clientX}px`;
    dragTooltip.style.top = `${e.clientY}px`;
    dragTooltip.textContent = formatTime(fraction);
  }

  // --- Clicking directly on Waveform to move edge ---
  function handleWaveformClick(e, rowIndex) {
    if (activeDragInfo) return;

    const row = state.rows[rowIndex];
    if (!row) return;

    if (row.mode !== 'rising' && row.mode !== 'falling' && row.mode !== 'pulse' && row.mode !== 'pulse_low' && row.mode !== 'clock') return;

    const container = e.currentTarget;
    const svg = container.querySelector('.waveform-svg');
    const svgRect = svg ? svg.getBoundingClientRect() : container.getBoundingClientRect();

    let fraction = (e.clientX - svgRect.left) / svgRect.width;
    fraction = Math.max(0, Math.min(1, fraction));

    if (state.snapGrid && !e.shiftKey) {
      fraction = Math.round(fraction / 0.05) * 0.05;
      fraction = Math.max(0, Math.min(1, fraction));
    }

    if (row.mode === 'pulse' || row.mode === 'pulse_low' || row.mode === 'clock') {
      const defaultE1 = row.mode === 'clock' ? 0.10 : 0.25;
      const defaultE2 = row.mode === 'clock' ? 0.90 : 0.75;
      const dist1 = Math.abs(fraction - (row.edge1 !== undefined ? row.edge1 : defaultE1));
      const dist2 = Math.abs(fraction - (row.edge2 !== undefined ? row.edge2 : defaultE2));
      if (dist1 <= dist2) {
        row.edge1 = fraction;
      } else {
        row.edge2 = fraction;
      }
    } else {
      row.edge1 = fraction;
    }

    saveState();
    renderRowWaveform(rowIndex);
  }

  // Double click waveform to quickly cycle mode (especially convenient when Type column is hidden)
  function handleWaveformDblClick(e, rowIndex) {
    const row = state.rows[rowIndex];
    if (!row) return;

    const modeCycle = ['rising', 'falling', 'pulse', 'pulse_low', 'clock', 'high', 'low'];
    const currentIdx = modeCycle.indexOf(row.mode);
    const nextIdx = (currentIdx + 1) % modeCycle.length;
    row.mode = modeCycle[nextIdx];

    if (row.mode === 'rising' && !row.edge1) row.edge1 = 0.25;
    if (row.mode === 'falling' && !row.edge1) row.edge1 = 0.75;
    if (row.mode === 'pulse' || row.mode === 'pulse_low') {
      if (!row.edge1) row.edge1 = 0.25;
      if (!row.edge2) row.edge2 = 0.75;
    }
    if (row.mode === 'clock') {
      if (row.edge1 === undefined) row.edge1 = 0.10;
      if (row.edge2 === undefined) row.edge2 = 0.90;
    }

    saveState();
    renderTable();
  }

  // Fast re-render of single row waveform
  function renderRowWaveform(rowIndex) {
    const row = state.rows[rowIndex];
    if (!row) return;

    const tr = tbody.querySelector(`tr[data-index="${rowIndex}"]`);
    if (!tr) return;

    const container = tr.querySelector('.waveform-cell-container');
    if (!container) return;

    populateWaveformContainer(container, row, rowIndex);
  }

  function renderAllRowWaveforms() {
    state.rows.forEach((_, i) => renderRowWaveform(i));
  }

  // --- Table Rows Rendering ---
  function renderTable() {
    tbody.innerHTML = '';

    const count = state.rows.length;
    rowCountBadge.textContent = `${count} Signal${count === 1 ? '' : 's'}`;

    if (count === 0) {
      emptyStateEl.classList.remove('hidden');
      return;
    } else {
      emptyStateEl.classList.add('hidden');
    }

    state.rows.forEach((row, index) => {
      const tr = document.createElement('tr');
      tr.className = 'sequence-row';
      tr.dataset.index = index;
      tr.dataset.id = row.id;

      // 1. Drag Handle
      const tdDrag = document.createElement('td');
      tdDrag.className = 'col-drag';
      const dragHandle = document.createElement('div');
      dragHandle.className = 'row-drag-handle';
      dragHandle.title = 'Click and drag to reorder row in real-time';
      dragHandle.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <circle cx="9" cy="6" r="1.8"></circle>
          <circle cx="15" cy="6" r="1.8"></circle>
          <circle cx="9" cy="12" r="1.8"></circle>
          <circle cx="15" cy="12" r="1.8"></circle>
          <circle cx="9" cy="18" r="1.8"></circle>
          <circle cx="15" cy="18" r="1.8"></circle>
        </svg>
      `;
      tdDrag.appendChild(dragHandle);
      tr.appendChild(tdDrag);

      // 2. Index #
      const tdIdx = document.createElement('td');
      tdIdx.className = 'col-idx row-index-cell';
      tdIdx.textContent = (index + 1).toString();
      tr.appendChild(tdIdx);

      // 3. Source Column
      const tdSource = document.createElement('td');
      tdSource.className = 'col-source';
      const inputSource = document.createElement('input');
      inputSource.type = 'text';
      inputSource.className = 'table-input';
      inputSource.value = row.source || '';
      inputSource.placeholder = 'e.g. PMIC';
      inputSource.addEventListener('input', (e) => {
        row.source = e.target.value;
        saveState();
      });
      tdSource.appendChild(inputSource);
      tr.appendChild(tdSource);

      // 4. Destination Column
      const tdDest = document.createElement('td');
      tdDest.className = 'col-dest';
      const inputDest = document.createElement('input');
      inputDest.type = 'text';
      inputDest.className = 'table-input';
      inputDest.value = row.destination || '';
      inputDest.placeholder = 'e.g. SoC VDD_CORE';
      inputDest.addEventListener('input', (e) => {
        row.destination = e.target.value;
        saveState();
      });
      tdDest.appendChild(inputDest);
      tr.appendChild(tdDest);

      // 5. Signal Name Column
      const tdSignal = document.createElement('td');
      tdSignal.className = 'col-signal';
      const rowColor = getRowColor(row, index);

      const inputSignal = document.createElement('input');
      inputSignal.type = 'text';
      inputSignal.className = 'table-input mono signal-name-input';
      inputSignal.style.color = rowColor;
      inputSignal.value = row.signalName || '';
      inputSignal.placeholder = 'e.g. VDD_3V3';
      inputSignal.addEventListener('input', (e) => {
        row.signalName = e.target.value;
        saveState();
      });

      tdSignal.appendChild(inputSignal);
      tr.appendChild(tdSignal);

      // 6. Voltage Column (Optional, Hideable)
      const tdVoltage = document.createElement('td');
      tdVoltage.className = 'col-voltage voltage-col-cell';
      const inputVoltage = document.createElement('input');
      inputVoltage.type = 'text';
      inputVoltage.className = 'table-input mono voltage-input';
      inputVoltage.value = row.voltage || '';
      inputVoltage.placeholder = 'e.g. 3.3V';
      inputVoltage.addEventListener('input', (e) => {
        row.voltage = e.target.value;
        saveState();
      });
      tdVoltage.appendChild(inputVoltage);
      tr.appendChild(tdVoltage);

      // 7. Waveform Type / Mode Select (Optional, Hideable)
      const tdMode = document.createElement('td');
      tdMode.className = 'col-mode type-col-cell';
      const selectMode = document.createElement('select');
      selectMode.className = 'mode-select';
      selectMode.innerHTML = `
        <option value="low">LOW only (0)</option>
        <option value="high">HIGH only (1)</option>
        <option value="rising">Sequence: Rising (0 → 1)</option>
        <option value="falling">Sequence: Falling (1 → 0)</option>
        <option value="pulse">Sequence: Pulse (0 → 1 → 0)</option>
        <option value="pulse_low">Sequence: Pulse (1 → 0 → 1)</option>
        <option value="clock">Clock (50% Square Wave)</option>
      `;
      selectMode.value = row.mode || 'rising';
      selectMode.addEventListener('change', (e) => {
        row.mode = e.target.value;
        if (row.mode === 'rising' && (row.edge1 === undefined || row.edge1 === 0)) {
          row.edge1 = 0.25;
        } else if (row.mode === 'falling' && (row.edge1 === undefined || row.edge1 === 0)) {
          row.edge1 = 0.75;
        } else if (row.mode === 'pulse' || row.mode === 'pulse_low') {
          if (!row.edge1) row.edge1 = 0.25;
          if (!row.edge2) row.edge2 = 0.75;
        } else if (row.mode === 'clock') {
          if (row.edge1 === undefined) row.edge1 = 0.10;
          if (row.edge2 === undefined) row.edge2 = 0.90;
        }
        saveState();
        renderRowWaveform(index);
      });
      tdMode.appendChild(selectMode);
      tr.appendChild(tdMode);

      // 8. Power Sequence Waveform Column
      const tdSeq = document.createElement('td');
      tdSeq.className = 'col-sequence';
      const wfContainer = document.createElement('div');
      wfContainer.className = 'waveform-cell-container';
      wfContainer.dataset.rowIndex = index;

      // Populate waveform SVG & HTML true circular dot markers
      populateWaveformContainer(wfContainer, row, index);

      // Click on waveform to move edge
      wfContainer.addEventListener('click', (e) => handleWaveformClick(e, index));
      wfContainer.addEventListener('dblclick', (e) => handleWaveformDblClick(e, index));

      // Crosshair synchronized guideline listeners
      wfContainer.addEventListener('mousemove', handleWaveformHover);
      wfContainer.addEventListener('mouseenter', () => crosshairGuide.classList.remove('hidden'));
      wfContainer.addEventListener('mouseleave', () => {
        if (!activeDragInfo) {
          crosshairGuide.classList.add('hidden');
        }
      });

      tdSeq.appendChild(wfContainer);
      tr.appendChild(tdSeq);

      // 9. Actions Column (Horizontal layout: Waterdrop color icon on left, Copy, Delete)
      const tdActions = document.createElement('td');
      tdActions.className = 'col-actions';
      const actionsGroup = document.createElement('div');
      actionsGroup.className = 'row-actions-group';

      // Color Palette Button (Waterdrop icon on left)
      const btnColor = document.createElement('button');
      btnColor.className = 'btn-row-action btn-row-color';
      btnColor.style.color = rowColor;
      btnColor.title = 'Change waveform color';
      btnColor.innerHTML = `
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path>
        </svg>
      `;
      btnColor.addEventListener('click', (e) => {
        e.stopPropagation();
        openColorPickerPopover(btnColor, row, index);
      });
      actionsGroup.appendChild(btnColor);

      // Duplicate Button
      const btnDuplicate = document.createElement('button');
      btnDuplicate.className = 'btn-row-action';
      btnDuplicate.title = 'Duplicate row';
      btnDuplicate.innerHTML = `
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
      `;
      btnDuplicate.addEventListener('click', () => duplicateRow(index));
      actionsGroup.appendChild(btnDuplicate);

      // Delete Button
      const btnDelete = document.createElement('button');
      btnDelete.className = 'btn-row-action delete';
      btnDelete.title = 'Delete row';
      btnDelete.innerHTML = `
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      `;
      btnDelete.addEventListener('click', () => deleteRow(index));
      actionsGroup.appendChild(btnDelete);

      tdActions.appendChild(actionsGroup);
      tr.appendChild(tdActions);

      // Setup Real-Time Pointer-Based Row Drag & Drop (Requirement 6)
      setupRealtimeRowDrag(tr, dragHandle, index);

      tbody.appendChild(tr);
    });
  }

  // --- Real-Time Row Drag & Drop with Floating Visual Preview (Requirement 6) ---
  function setupRealtimeRowDrag(tr, handle, initialIndex) {
    handle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();

      const startY = e.clientY;
      const startX = e.clientX;
      const rowHeight = tr.offsetHeight;
      const rowWidth = tr.offsetWidth;
      const initialRect = tr.getBoundingClientRect();

      activeRowDrag = {
        tr,
        currentIndex: initialIndex,
        startY,
        startX,
        offsetY: e.clientY - initialRect.top,
        rowHeight,
        rowWidth,
        isDragging: false
      };
    });
  }

  function handleRowDragMove(e) {
    if (!activeRowDrag) return;

    // Initiate drag threshold
    if (!activeRowDrag.isDragging) {
      if (Math.abs(e.clientY - activeRowDrag.startY) > 3) {
        activeRowDrag.isDragging = true;
        activeRowDrag.tr.classList.add('row-placeholder');

        // Create floating preview
        dragRowGhost.innerHTML = '';
        const ghostTable = document.createElement('table');
        ghostTable.style.width = activeRowDrag.rowWidth + 'px';
        const ghostTbody = document.createElement('tbody');
        const cloneRow = activeRowDrag.tr.cloneNode(true);
        cloneRow.classList.remove('row-placeholder');
        ghostTbody.appendChild(cloneRow);
        ghostTable.appendChild(ghostTbody);
        dragRowGhost.appendChild(ghostTable);

        dragRowGhost.style.width = activeRowDrag.rowWidth + 'px';
        dragRowGhost.classList.remove('hidden');
        document.body.style.cursor = 'grabbing';
      } else {
        return;
      }
    }

    // Update floating ghost position
    const tableRect = tableScrollWrapper.getBoundingClientRect();
    dragRowGhost.style.top = `${e.clientY - activeRowDrag.offsetY}px`;
    dragRowGhost.style.left = `${tableRect.left}px`;

    // Real-Time Live Row Rearranging while moving over other rows!
    const rows = Array.from(tbody.querySelectorAll('.sequence-row'));
    for (let i = 0; i < rows.length; i++) {
      const targetTr = rows[i];
      if (targetTr === activeRowDrag.tr) continue;

      const rect = targetTr.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;

      // When cursor crosses row threshold, immediately swap/reposition in DOM & state
      if (
        (i < activeRowDrag.currentIndex && e.clientY < midY) ||
        (i > activeRowDrag.currentIndex && e.clientY > midY)
      ) {
        // Reorder data array
        const [movedItem] = state.rows.splice(activeRowDrag.currentIndex, 1);
        state.rows.splice(i, 0, movedItem);

        // Reorder DOM
        if (i > activeRowDrag.currentIndex) {
          tbody.insertBefore(activeRowDrag.tr, targetTr.nextSibling);
        } else {
          tbody.insertBefore(activeRowDrag.tr, targetTr);
        }

        activeRowDrag.currentIndex = i;

        // Instantly update index column (#) in all visible rows in real-time
        const currentRows = tbody.querySelectorAll('.sequence-row');
        currentRows.forEach((r, idx) => {
          r.dataset.index = idx;
          const idxCell = r.querySelector('.row-index-cell');
          if (idxCell) idxCell.textContent = (idx + 1).toString();
        });

        break;
      }
    }
  }

  function handleRowDragEnd() {
    if (!activeRowDrag) return;

    if (activeRowDrag.isDragging) {
      activeRowDrag.tr.classList.remove('row-placeholder');
      dragRowGhost.classList.add('hidden');
      dragRowGhost.innerHTML = '';
      document.body.style.cursor = '';
      saveState();
      // Clean re-render to bind all listeners with new indices
      renderTable();
    }

    activeRowDrag = null;
  }

  // --- Synchronized Crosshair Guideline ---
  function updateCrosshairGuide(clientX, container, fraction) {
    if (!container || !tableScrollWrapper) return;
    const wrapperRect = tableScrollWrapper.getBoundingClientRect();
    const rect = container.getBoundingClientRect();

    if (fraction === undefined) {
      fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    }

    // Place crosshair line aligned with mouse/marker inside scroll container
    const relativeX = clientX - wrapperRect.left + tableScrollWrapper.scrollLeft;
    crosshairGuide.style.left = `${relativeX}px`;
    crosshairGuide.classList.remove('hidden');

    if (state.appMode === 'advanced') {
      const timeVal = (fraction * state.maxTime).toFixed(1);
      crosshairBadge.textContent = `${timeVal} ${state.timeUnit}`;

      // Prevent badge from expanding scroll container when near edges
      const rightDistance = wrapperRect.width - (clientX - wrapperRect.left);
      if (rightDistance < 50) {
        crosshairBadge.style.transform = 'translateX(-100%)';
      } else if (clientX - wrapperRect.left < 50) {
        crosshairBadge.style.transform = 'translateX(0%)';
      } else {
        crosshairBadge.style.transform = 'translateX(-50%)';
      }
    }
  }

  function handleWaveformHover(e) {
    if (activeDragInfo || activeRowDrag) return;
    updateCrosshairGuide(e.clientX, e.currentTarget);
  }

  // --- Waveform Color Management (7 Distinct Choices) ---
  let activePopoverRowIndex = null;

  function openColorPickerPopover(anchorEl, row, rowIndex) {
    if (!rowColorPopover || !popoverSwatchesEl) return;
    activePopoverRowIndex = rowIndex;
    const currentColor = getRowColor(row, rowIndex);

    popoverSwatchesEl.innerHTML = '';
    WAVEFORM_COLORS.forEach(c => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `color-swatch-circle ${c.hex.toLowerCase() === currentColor.toLowerCase() ? 'selected' : ''}`;
      btn.style.backgroundColor = c.hex;
      btn.title = c.name;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        setRowColor(rowIndex, c.hex);
        closeColorPickerPopover();
      });
      popoverSwatchesEl.appendChild(btn);
    });

    rowColorPopover.classList.remove('hidden');

    const rect = anchorEl.getBoundingClientRect();
    const popoverRect = rowColorPopover.getBoundingClientRect();
    let left = rect.left;
    let top = rect.bottom + 6;

    if (left + popoverRect.width > window.innerWidth - 10) {
      left = window.innerWidth - popoverRect.width - 10;
    }
    if (top + popoverRect.height > window.innerHeight - 10) {
      top = rect.top - popoverRect.height - 6;
    }

    rowColorPopover.style.left = `${Math.max(10, left)}px`;
    rowColorPopover.style.top = `${Math.max(10, top)}px`;
  }

  function closeColorPickerPopover() {
    if (rowColorPopover) {
      rowColorPopover.classList.add('hidden');
    }
    activePopoverRowIndex = null;
  }

  function setRowColor(rowIndex, hex) {
    const row = state.rows[rowIndex];
    if (!row) return;
    row.color = hex;
    saveState();
    renderRowWaveform(rowIndex);

    // Update row visual accents
    const tr = tbody.querySelector(`tr[data-index="${rowIndex}"]`);
    if (tr) {
      const sigInput = tr.querySelector('.signal-name-input');
      if (sigInput) sigInput.style.color = hex;
      const btnColor = tr.querySelector('.btn-row-color');
      if (btnColor) btnColor.style.color = hex;
    }
  }

  function applyColorToAll(hex) {
    state.rows.forEach(r => { r.color = hex; });
    saveState();
    renderAll();
    if (colorMenu) colorMenu.classList.remove('show');
  }

  function applyMultiColorToAll() {
    state.rows.forEach((r, idx) => {
      r.color = WAVEFORM_COLORS[idx % WAVEFORM_COLORS.length].hex;
    });
    saveState();
    renderAll();
    if (colorMenu) colorMenu.classList.remove('show');
  }

  // --- Row Operations ---
  function addRow() {
    const lastRow = state.rows[state.rows.length - 1];
    let nextEdge = 0.25;
    if (lastRow && lastRow.edge1 !== undefined) {
      nextEdge = Math.min(0.95, parseFloat((lastRow.edge1 + 0.15).toFixed(2)));
    }

    const newRow = {
      id: 'row_' + Date.now(),
      source: '',
      destination: '',
      signalName: 'SIGNAL_' + (state.rows.length + 1),
      voltage: '3.3V',
      mode: 'rising',
      edge1: nextEdge,
      edge2: 0.85,
      color: WAVEFORM_COLORS[state.rows.length % WAVEFORM_COLORS.length].hex
    };

    state.rows.push(newRow);
    saveState();
    renderAll();

    // Auto-focus on new row's signal name input
    setTimeout(() => {
      const inputs = tbody.querySelectorAll('.signal-name-input');
      if (inputs.length > 0) {
        inputs[inputs.length - 1].focus();
        inputs[inputs.length - 1].select();
      }
    }, 60);
  }

  function duplicateRow(index) {
    const orig = state.rows[index];
    if (!orig) return;

    const copy = JSON.parse(JSON.stringify(orig));
    copy.id = 'row_' + Date.now();
    copy.signalName = orig.signalName + '_COPY';
    copy.color = orig.color || WAVEFORM_COLORS[0].hex;
    if (copy.edge1 !== undefined) {
      copy.edge1 = Math.min(0.95, parseFloat((copy.edge1 + 0.05).toFixed(2)));
    }

    state.rows.splice(index + 1, 0, copy);
    saveState();
    renderAll();
  }

  function deleteRow(index) {
    const sig = state.rows[index]?.signalName || 'this signal';
    if (confirm(`Delete "${sig}"?`)) {
      state.rows.splice(index, 1);
      saveState();
      renderAll();
    }
  }

  function clearAllRows() {
    if (state.rows.length === 0) return;
    if (confirm('Clear all power sequence rows?')) {
      state.rows = [];
      saveState();
      renderAll();
    }
  }

  function loadSampleData() {
    state.rows = JSON.parse(JSON.stringify(DEFAULT_SAMPLE_DATA));
    saveState();
    renderAll();
  }

  // --- Export & Import Features ---
  function exportJson() {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(state, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', 'power_sequence_timing.json');
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        if (Array.isArray(parsed.rows)) {
          state.rows = parsed.rows;
          if (parsed.appMode) state.appMode = parsed.appMode;
          if (parsed.timeUnit) state.timeUnit = parsed.timeUnit;
          if (parsed.maxTime !== undefined) state.maxTime = parsed.maxTime;
          if (parsed.hideVoltage !== undefined) state.hideVoltage = parsed.hideVoltage;
          if (parsed.hideType !== undefined) state.hideType = parsed.hideType;
          if (parsed.colWidths) state.colWidths = parsed.colWidths;
          
          timeUnitSelect.value = state.timeUnit;
          maxTimeInput.value = state.maxTime;
          applyAppMode();
          applyVoltageColumnVisibility();
          applyTypeColumnVisibility();
          applyColumnWidths();

          saveState();
          renderAll();
          alert('Power sequence project loaded successfully!');
        } else {
          alert('Invalid JSON file format.');
        }
      } catch (err) {
        alert('Failed to parse JSON file: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  function exportCsv() {
    const headers = ['#', 'Source', 'Destination', 'Signal Name', 'Voltage', 'Waveform Type', `Transition Time (${state.timeUnit})`];
    const rows = state.rows.map((r, i) => {
      let timeDesc = 'N/A';
      if (r.mode === 'rising' || r.mode === 'falling') {
        timeDesc = (r.edge1 * state.maxTime).toFixed(2);
      } else if (r.mode === 'pulse' || r.mode === 'pulse_low') {
        timeDesc = `${(r.edge1 * state.maxTime).toFixed(2)} to ${(r.edge2 * state.maxTime).toFixed(2)}`;
      } else if (r.mode === 'clock') {
        const eA = Math.min(r.edge1 !== undefined ? r.edge1 : 0.10, r.edge2 !== undefined ? r.edge2 : 0.90);
        const eB = Math.max(r.edge1 !== undefined ? r.edge1 : 0.10, r.edge2 !== undefined ? r.edge2 : 0.90);
        timeDesc = `${(eA * state.maxTime).toFixed(2)} to ${(eB * state.maxTime).toFixed(2)} (Clock)`;
      }
      return [
        i + 1,
        `"${(r.source || '').replace(/"/g, '""')}"`,
        `"${(r.destination || '').replace(/"/g, '""')}"`,
        `"${(r.signalName || '').replace(/"/g, '""')}"`,
        `"${(r.voltage || '').replace(/"/g, '""')}"`,
        `"${r.mode}"`,
        `"${timeDesc}"`
      ].join(',');
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + encodeURIComponent([headers.join(','), ...rows].join('\n'));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', csvContent);
    downloadAnchor.setAttribute('download', 'power_sequence_table.csv');
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  }

  // Standalone Vector SVG Export for Hardware Review
  function exportSvgDiagram() {
    const rowHeight = 46;
    const headerHeight = 75;
    const labelColWidth = 320;
    const waveWidth = 800;
    const totalWidth = labelColWidth + waveWidth + 40;
    const totalHeight = headerHeight + (state.rows.length * rowHeight) + 40;
    const isBasic = state.appMode === 'basic';

    let svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}" style="background-color:#0b0f17; font-family:'Inter', sans-serif;">
      <style>
        .title { fill:#f0f4f8; font-size:16px; font-weight:700; }
        .subtitle { fill:#94a3b8; font-size:11px; }
        .row-bg { fill:#131a26; }
        .row-alt { fill:#151d2c; }
        .sig-label { font-family:'JetBrains Mono', monospace; font-size:12px; font-weight:600; }
        .volt-label { fill:#f59e0b; font-family:'JetBrains Mono', monospace; font-size:11px; font-weight:600; }
        .src-dest { fill:#94a3b8; font-size:10px; }
        .tick-text { fill:#64748b; font-size:9px; font-family:'JetBrains Mono', monospace; }
        .tick-line { stroke:rgba(255,255,255,0.08); stroke-width:1; }
        .tick-line-major { stroke:rgba(255,255,255,0.18); stroke-width:1; }
      </style>
      <rect width="100%" height="100%" fill="#0b0f17"/>
      <text x="20" y="28" class="title">Power Sequence Timing Diagram</text>
      <text x="20" y="46" class="subtitle">Mode: ${isBasic ? 'Basic' : 'Advanced'} • ${isBasic ? 'Timing Sequence' : `Max Time: ${state.maxTime} ${escapeXml(state.timeUnit)}`}</text>
    `;

    // Ruler ticks
    const rulerY = 58;
    for (let i = 0; i <= 10; i++) {
      const frac = i / 10;
      const x = labelColWidth + (frac * waveWidth);
      const lineClass = i % 2 === 0 ? 'tick-line-major' : 'tick-line';
      svgContent += `<line x1="${x}" y1="${rulerY}" x2="${x}" y2="${totalHeight - 20}" class="${lineClass}"/>`;
      if (!isBasic) {
        const timeVal = (frac * state.maxTime).toFixed(frac === 0 || frac === 1 ? 0 : 1);
        svgContent += `<text x="${x + 2}" y="${rulerY + 10}" class="tick-text">${timeVal}${escapeXml(state.timeUnit)}</text>`;
      }
    }

    // Rows
    state.rows.forEach((row, i) => {
      const y = headerHeight + (i * rowHeight);
      const rowBgClass = i % 2 === 0 ? 'row-bg' : 'row-alt';
      const rowColor = getRowColor(row, i);
      const rowBg = hexToRgba(rowColor, 0.15);

      svgContent += `<rect x="15" y="${y}" width="${totalWidth - 30}" height="${rowHeight - 4}" class="${rowBgClass}" rx="4"/>`;

      // Labels with complete XML entity escaping to avoid xmlParseEntityRef errors
      const safeSignal = escapeXml(row.signalName || 'SIGNAL');
      const safeSrc = escapeXml(row.source || '');
      const safeDest = escapeXml(row.destination || '');
      const srcDest = [safeSrc, safeDest].filter(Boolean).join(' → ');
      const safeVolt = escapeXml(row.voltage || '');

      svgContent += `
        <text x="25" y="${y + 18}" class="sig-label" fill="${rowColor}">${safeSignal}</text>
        <text x="25" y="${y + 32}" class="src-dest">${srcDest || '—'}</text>
        <text x="${labelColWidth - 45}" y="${y + 24}" class="volt-label">${safeVolt}</text>
      `;

      // Waveform
      const wyLow = y + rowHeight - 12;
      const wyHigh = y + 10;
      const wyMid = (wyLow + wyHigh) / 2;
      const wx0 = labelColWidth;
      const wx1 = labelColWidth + waveWidth;

      let traceD = '';
      let fillD = '';
      let dotX = null;
      let dotX2 = null;

      if (row.mode === 'low') {
        traceD = `M ${wx0} ${wyLow} L ${wx1} ${wyLow}`;
      } else if (row.mode === 'high') {
        traceD = `M ${wx0} ${wyHigh} L ${wx1} ${wyHigh}`;
        fillD = `M ${wx0} ${wyHigh} L ${wx1} ${wyHigh} L ${wx1} ${wyLow} L ${wx0} ${wyLow} Z`;
      } else if (row.mode === 'rising') {
        dotX = wx0 + (row.edge1 * waveWidth);
        traceD = `M ${wx0} ${wyLow} L ${dotX - 6} ${wyLow} L ${dotX + 6} ${wyHigh} L ${wx1} ${wyHigh}`;
        fillD = `M ${dotX - 6} ${wyLow} L ${dotX + 6} ${wyHigh} L ${wx1} ${wyHigh} L ${wx1} ${wyLow} Z`;
      } else if (row.mode === 'falling') {
        dotX = wx0 + (row.edge1 * waveWidth);
        traceD = `M ${wx0} ${wyHigh} L ${dotX - 6} ${wyHigh} L ${dotX + 6} ${wyLow} L ${wx1} ${wyLow}`;
        fillD = `M ${wx0} ${wyHigh} L ${dotX - 6} ${wyHigh} L ${dotX + 6} ${wyLow} L ${wx0} ${wyLow} Z`;
      } else if (row.mode === 'pulse') {
        const eA = Math.min(row.edge1 !== undefined ? row.edge1 : 0.25, row.edge2 !== undefined ? row.edge2 : 0.75);
        const eB = Math.max(row.edge1 !== undefined ? row.edge1 : 0.25, row.edge2 !== undefined ? row.edge2 : 0.75);
        dotX = wx0 + (eA * waveWidth);
        dotX2 = wx0 + (eB * waveWidth);
        traceD = `M ${wx0} ${wyLow} L ${dotX - 6} ${wyLow} L ${dotX + 6} ${wyHigh} L ${dotX2 - 6} ${wyHigh} L ${dotX2 + 6} ${wyLow} L ${wx1} ${wyLow}`;
        fillD = `M ${dotX - 6} ${wyLow} L ${dotX + 6} ${wyHigh} L ${dotX2 - 6} ${wyHigh} L ${dotX2 + 6} ${wyLow} Z`;
      } else if (row.mode === 'pulse_low') {
        const eA = Math.min(row.edge1 !== undefined ? row.edge1 : 0.25, row.edge2 !== undefined ? row.edge2 : 0.75);
        const eB = Math.max(row.edge1 !== undefined ? row.edge1 : 0.25, row.edge2 !== undefined ? row.edge2 : 0.75);
        dotX = wx0 + (eA * waveWidth);
        dotX2 = wx0 + (eB * waveWidth);
        traceD = `M ${wx0} ${wyHigh} L ${dotX - 6} ${wyHigh} L ${dotX + 6} ${wyLow} L ${dotX2 - 6} ${wyLow} L ${dotX2 + 6} ${wyHigh} L ${wx1} ${wyHigh}`;
        fillD = `M ${wx0} ${wyHigh} L ${dotX - 6} ${wyHigh} L ${dotX + 6} ${wyLow} L ${wx0} ${wyLow} Z M ${dotX2 - 6} ${wyLow} L ${dotX2 + 6} ${wyHigh} L ${wx1} ${wyHigh} L ${wx1} ${wyLow} Z`;
      } else if (row.mode === 'clock') {
        const eA = Math.min(row.edge1 !== undefined ? row.edge1 : 0.10, row.edge2 !== undefined ? row.edge2 : 0.90);
        const eB = Math.max(row.edge1 !== undefined ? row.edge1 : 0.10, row.edge2 !== undefined ? row.edge2 : 0.90);
        dotX = wx0 + (eA * waveWidth);
        dotX2 = wx0 + (eB * waveWidth);
        const period = 40; // Double frequency: 20 cycles across 800px
        const halfPeriod = 20;

        let dTrace = `M ${wx0} ${wyLow} L ${dotX} ${wyLow}`;
        let dFill = '';
        let curX = dotX;

        while (curX < dotX2) {
          const highEnd = Math.min(dotX2, curX + halfPeriod);
          dTrace += ` L ${curX} ${wyHigh} L ${highEnd} ${wyHigh}`;
          dFill += `M ${curX} ${wyLow} L ${curX} ${wyHigh} L ${highEnd} ${wyHigh} L ${highEnd} ${wyLow} Z `;
          if (highEnd >= dotX2) {
            dTrace += ` L ${dotX2} ${wyLow}`;
            break;
          }
          const lowEnd = Math.min(dotX2, curX + period);
          dTrace += ` L ${highEnd} ${wyLow} L ${lowEnd} ${wyLow}`;
          curX = lowEnd;
        }
        dTrace += ` L ${wx1} ${wyLow}`;
        traceD = dTrace;
        fillD = dFill;
      }

      if (fillD) {
        svgContent += `<path d="${fillD}" fill="${rowBg}"/>`;
      }
      svgContent += `<path d="${traceD}" stroke="${rowColor}" stroke-width="2.5" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`;
    });

    svgContent += `</svg>`;

    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', url);
    downloadAnchor.setAttribute('download', 'power_sequence_diagram.svg');
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    URL.revokeObjectURL(url);
  }

  // Shared High-Resolution Diagram Canvas Renderer
  function renderDiagramCanvas(scale = 2) {
    const rowHeight = 46;
    const headerHeight = 75;
    const labelColWidth = 320;
    const waveWidth = 800;
    const totalWidth = labelColWidth + waveWidth + 40;
    const totalHeight = headerHeight + (state.rows.length * rowHeight) + 40;
    const isBasic = state.appMode === 'basic';

    const canvas = document.createElement('canvas');
    canvas.width = totalWidth * scale; // High-DPI
    canvas.height = totalHeight * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);

    // Background
    ctx.fillStyle = '#0b0f17';
    ctx.fillRect(0, 0, totalWidth, totalHeight);

    // Title
    ctx.fillStyle = '#f0f4f8';
    ctx.font = 'bold 16px Inter, sans-serif';
    ctx.fillText('Power Sequence Timing Diagram', 20, 28);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px Inter, sans-serif';
    const sub = isBasic ? 'Mode: Basic Timing Sequence' : `Mode: Advanced • Max Time: ${state.maxTime} ${state.timeUnit}`;
    ctx.fillText(sub, 20, 46);

    // Grid ticks
    const rulerY = 58;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillStyle = '#64748b';
    ctx.font = '9px JetBrains Mono, monospace';

    for (let i = 0; i <= 10; i++) {
      const frac = i / 10;
      const x = labelColWidth + (frac * waveWidth);
      
      ctx.beginPath();
      ctx.moveTo(x, rulerY);
      ctx.lineTo(x, totalHeight - 20);
      ctx.stroke();

      if (!isBasic) {
        const timeVal = (frac * state.maxTime).toFixed(frac === 0 || frac === 1 ? 0 : 1);
        ctx.fillText(`${timeVal}${state.timeUnit}`, x + 2, rulerY + 10);
      }
    }

    // Rows
    state.rows.forEach((row, i) => {
      const y = headerHeight + (i * rowHeight);
      const rowColor = getRowColor(row, i);
      const rowBg = hexToRgba(rowColor, 0.15);

      ctx.fillStyle = i % 2 === 0 ? '#131a26' : '#151d2c';
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(15, y, totalWidth - 30, rowHeight - 4, 4);
        ctx.fill();
      } else {
        ctx.fillRect(15, y, totalWidth - 30, rowHeight - 4);
      }

      // Signal Name
      ctx.fillStyle = rowColor;
      ctx.font = 'bold 12px JetBrains Mono, monospace';
      ctx.fillText(row.signalName || 'SIGNAL', 25, y + 18);

      // Source -> Dest
      const srcDest = [row.source, row.destination].filter(Boolean).join(' → ');
      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px Inter, sans-serif';
      ctx.fillText(srcDest || '—', 25, y + 32);

      // Voltage
      ctx.fillStyle = '#f59e0b';
      ctx.font = 'bold 11px JetBrains Mono, monospace';
      ctx.fillText(row.voltage || '', labelColWidth - 50, y + 24);

      // Waveform
      const wyLow = y + rowHeight - 12;
      const wyHigh = y + 10;
      const wyMid = (wyLow + wyHigh) / 2;
      const wx0 = labelColWidth;
      const wx1 = labelColWidth + waveWidth;

      ctx.strokeStyle = rowColor;
      ctx.lineWidth = 2.5;
      ctx.fillStyle = rowBg;

      let dotX = null;
      let dotX2 = null;

      ctx.beginPath();
      if (row.mode === 'low') {
        ctx.moveTo(wx0, wyLow);
        ctx.lineTo(wx1, wyLow);
        ctx.stroke();
      } else if (row.mode === 'high') {
        ctx.moveTo(wx0, wyHigh);
        ctx.lineTo(wx1, wyHigh);
        ctx.stroke();
        ctx.fillRect(wx0, wyHigh, waveWidth, wyLow - wyHigh);
      } else if (row.mode === 'rising') {
        dotX = wx0 + (row.edge1 * waveWidth);
        ctx.moveTo(wx0, wyLow);
        ctx.lineTo(dotX - 6, wyLow);
        ctx.lineTo(dotX + 6, wyHigh);
        ctx.lineTo(wx1, wyHigh);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(dotX - 6, wyLow);
        ctx.lineTo(dotX + 6, wyHigh);
        ctx.lineTo(wx1, wyHigh);
        ctx.lineTo(wx1, wyLow);
        ctx.closePath();
        ctx.fill();
      } else if (row.mode === 'falling') {
        dotX = wx0 + (row.edge1 * waveWidth);
        ctx.moveTo(wx0, wyHigh);
        ctx.lineTo(dotX - 6, wyHigh);
        ctx.lineTo(dotX + 6, wyLow);
        ctx.lineTo(wx1, wyLow);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(wx0, wyHigh);
        ctx.lineTo(dotX - 6, wyHigh);
        ctx.lineTo(dotX + 6, wyLow);
        ctx.lineTo(wx0, wyLow);
        ctx.closePath();
        ctx.fill();
      } else if (row.mode === 'pulse') {
        const eA = Math.min(row.edge1 !== undefined ? row.edge1 : 0.25, row.edge2 !== undefined ? row.edge2 : 0.75);
        const eB = Math.max(row.edge1 !== undefined ? row.edge1 : 0.25, row.edge2 !== undefined ? row.edge2 : 0.75);
        dotX = wx0 + (eA * waveWidth);
        dotX2 = wx0 + (eB * waveWidth);

        ctx.moveTo(wx0, wyLow);
        ctx.lineTo(dotX - 6, wyLow);
        ctx.lineTo(dotX + 6, wyHigh);
        ctx.lineTo(dotX2 - 6, wyHigh);
        ctx.lineTo(dotX2 + 6, wyLow);
        ctx.lineTo(wx1, wyLow);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(dotX - 6, wyLow);
        ctx.lineTo(dotX + 6, wyHigh);
        ctx.lineTo(dotX2 - 6, wyHigh);
        ctx.lineTo(dotX2 + 6, wyLow);
        ctx.closePath();
        ctx.fill();
      } else if (row.mode === 'pulse_low') {
        const eA = Math.min(row.edge1 !== undefined ? row.edge1 : 0.25, row.edge2 !== undefined ? row.edge2 : 0.75);
        const eB = Math.max(row.edge1 !== undefined ? row.edge1 : 0.25, row.edge2 !== undefined ? row.edge2 : 0.75);
        dotX = wx0 + (eA * waveWidth);
        dotX2 = wx0 + (eB * waveWidth);

        ctx.beginPath();
        ctx.moveTo(wx0, wyHigh);
        ctx.lineTo(dotX - 6, wyHigh);
        ctx.lineTo(dotX + 6, wyLow);
        ctx.lineTo(dotX2 - 6, wyLow);
        ctx.lineTo(dotX2 + 6, wyHigh);
        ctx.lineTo(wx1, wyHigh);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(wx0, wyHigh);
        ctx.lineTo(dotX - 6, wyHigh);
        ctx.lineTo(dotX + 6, wyLow);
        ctx.lineTo(wx0, wyLow);
        ctx.closePath();
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(dotX2 - 6, wyLow);
        ctx.lineTo(dotX2 + 6, wyHigh);
        ctx.lineTo(wx1, wyHigh);
        ctx.lineTo(wx1, wyLow);
        ctx.closePath();
        ctx.fill();
      } else if (row.mode === 'clock') {
        const eA = Math.min(row.edge1 !== undefined ? row.edge1 : 0.10, row.edge2 !== undefined ? row.edge2 : 0.90);
        const eB = Math.max(row.edge1 !== undefined ? row.edge1 : 0.10, row.edge2 !== undefined ? row.edge2 : 0.90);
        dotX = wx0 + (eA * waveWidth);
        dotX2 = wx0 + (eB * waveWidth);
        const period = 40; // Double frequency: 20 cycles across 800px
        const halfPeriod = 20;

        ctx.beginPath();
        ctx.moveTo(wx0, wyLow);
        ctx.lineTo(dotX, wyLow);
        let curX = dotX;

        while (curX < dotX2) {
          const highEnd = Math.min(dotX2, curX + halfPeriod);
          ctx.lineTo(curX, wyHigh);
          ctx.lineTo(highEnd, wyHigh);
          if (highEnd >= dotX2) {
            ctx.lineTo(dotX2, wyLow);
            break;
          }
          const lowEnd = Math.min(dotX2, curX + period);
          ctx.lineTo(highEnd, wyLow);
          ctx.lineTo(lowEnd, wyLow);
          curX = lowEnd;
        }
        ctx.lineTo(wx1, wyLow);
        ctx.stroke();

        // Fill high pulses
        ctx.beginPath();
        curX = dotX;
        while (curX < dotX2) {
          const highEnd = Math.min(dotX2, curX + halfPeriod);
          ctx.rect(curX, wyHigh, highEnd - curX, wyLow - wyHigh);
          if (highEnd >= dotX2) break;
          curX = Math.min(dotX2, curX + period);
        }
        ctx.fill();
      }
    });

    return { canvas, totalWidth, totalHeight };
  }

  // Export PNG via Canvas
  function exportPngDiagram() {
    const { canvas } = renderDiagramCanvas(2);
    const link = document.createElement('a');
    link.download = 'power_sequence_diagram.png';
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  // Helper: Convert Base64 string to Uint8Array
  function base64ToUint8Array(base64) {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  // Pure Client-Side ISO PDF 1.4 Binary Generator (Zero Clipping, Complete Diagram)
  function generatePdfBlob(widthPt, heightPt, jpegBase64, imgWidthPx, imgHeightPx) {
    const encoder = new TextEncoder();
    const imgBytes = base64ToUint8Array(jpegBase64);
    const imgLength = imgBytes.length;

    let headerStr = '%PDF-1.4\n';
    const offsets = [];

    // Obj 1: Catalog
    offsets.push(encoder.encode(headerStr).length);
    headerStr += '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';

    // Obj 2: Pages
    offsets.push(encoder.encode(headerStr).length);
    headerStr += '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';

    // Obj 3: Page (MediaBox sized exactly to full diagram dimensions, zero clipping)
    offsets.push(encoder.encode(headerStr).length);
    headerStr += `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt.toFixed(2)} ${heightPt.toFixed(2)}] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`;

    // Obj 4: Image XObject header
    offsets.push(encoder.encode(headerStr).length);
    headerStr += `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgWidthPx} /Height ${imgHeightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgLength} >>\nstream\n`;

    const headBytes = encoder.encode(headerStr);
    const streamCloseBytes = encoder.encode('\nendstream\nendobj\n');

    // Obj 5: Page contents stream
    const contentStream = `q\n${widthPt.toFixed(2)} 0 0 ${heightPt.toFixed(2)} 0 0 cm\n/Im1 Do\nQ\n`;
    const contentObj = `5 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}endstream\nendobj\n`;
    const contentBytes = encoder.encode(contentObj);

    const obj5Offset = headBytes.length + imgBytes.length + streamCloseBytes.length;

    // Cross-Reference Table
    const xrefOffset = obj5Offset + contentBytes.length;
    let xrefStr = 'xref\n0 6\n0000000000 65535 f \n';
    for (let i = 0; i < 4; i++) {
      xrefStr += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    }
    xrefStr += String(obj5Offset).padStart(10, '0') + ' 00000 n \n';
    xrefStr += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    const xrefBytes = encoder.encode(xrefStr);

    return new Blob([headBytes, imgBytes, streamCloseBytes, contentBytes, xrefBytes], { type: 'application/pdf' });
  }

  // Standalone Complete PDF Export (Zero clipping, full table and sequence waveform)
  function exportPdfDiagram() {
    const { canvas, totalWidth, totalHeight } = renderDiagramCanvas(2);
    // Export High-Res JPEG (0.95 quality)
    const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.95);
    const base64Data = jpegDataUrl.split(',')[1];

    // Convert pixel dimensions to PDF points (1 pt = 1/72 in, 1 px = 1/96 in; pt = px * 0.75)
    const widthPt = totalWidth * 0.75;
    const heightPt = totalHeight * 0.75;

    const blob = generatePdfBlob(widthPt, heightPt, base64Data, canvas.width, canvas.height);
    const url = URL.createObjectURL(blob);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', url);
    downloadAnchor.setAttribute('download', 'power_sequence_diagram.pdf');
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

// --- Global Event Listeners ---
  function setupEventListeners() {
    // Mode switcher
    modeBtnBasic.addEventListener('click', () => setAppMode('basic'));
    modeBtnAdvanced.addEventListener('click', () => setAppMode('advanced'));

    // Toolbar buttons
    document.getElementById('add-row-btn').addEventListener('click', addRow);
    document.getElementById('load-sample-btn').addEventListener('click', loadSampleData);
    document.getElementById('clear-all-btn').addEventListener('click', clearAllRows);
    toggleVoltageBtn.addEventListener('click', toggleVoltageColumn);
    toggleTypeBtn.addEventListener('click', toggleTypeColumn);
    themeToggleBtn.addEventListener('click', toggleTheme);

    // Time settings
    timeUnitSelect.addEventListener('change', (e) => {
      state.timeUnit = e.target.value;
      saveState();
      renderAll();
    });

    maxTimeInput.addEventListener('change', (e) => {
      const val = parseFloat(e.target.value);
      if (!isNaN(val) && val > 0) {
        state.maxTime = val;
        saveState();
        renderAll();
      }
    });

    snapGridCheckbox.addEventListener('change', (e) => {
      state.snapGrid = e.target.checked;
      saveState();
    });

    // Global Color dropdown menu
    if (paletteSwatchesAll) {
      paletteSwatchesAll.innerHTML = '';
      WAVEFORM_COLORS.forEach(c => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'color-swatch-circle';
        btn.style.backgroundColor = c.hex;
        btn.title = `Apply ${c.name} to all waveforms`;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          applyColorToAll(c.hex);
        });
        paletteSwatchesAll.appendChild(btn);
      });
    }

    if (colorDropdownBtn) {
      colorDropdownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        colorMenu.classList.toggle('show');
        exportMenu.classList.remove('show');
        closeColorPickerPopover();
      });
    }

    if (colorMultiBtn) {
      colorMultiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        applyMultiColorToAll();
      });
    }

    if (colorMenu) {
      colorMenu.addEventListener('click', (e) => e.stopPropagation());
    }

    if (rowColorPopover) {
      rowColorPopover.addEventListener('click', (e) => e.stopPropagation());
    }

    // Export dropdown toggle
    exportDropdownBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      exportMenu.classList.toggle('show');
      if (colorMenu) colorMenu.classList.remove('show');
      closeColorPickerPopover();
    });

    document.addEventListener('click', () => {
      exportMenu.classList.remove('show');
      if (colorMenu) colorMenu.classList.remove('show');
      closeColorPickerPopover();
    });

    // Export actions
    document.getElementById('export-pdf-btn').addEventListener('click', exportPdfDiagram);
    document.getElementById('export-json-btn').addEventListener('click', exportJson);
    document.getElementById('export-svg-btn').addEventListener('click', exportSvgDiagram);
    document.getElementById('export-png-btn').addEventListener('click', exportPngDiagram);
    document.getElementById('export-csv-btn').addEventListener('click', exportCsv);
    document.getElementById('print-page-btn')?.addEventListener('click', () => {
      exportMenu.classList.remove('show');
      window.print();
    });

    // Import file input
    const importFileInput = document.getElementById('import-file-input');
    importFileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        importJson(e.target.files[0]);
        e.target.value = '';
      }
    });
  }

  function setupGlobalPointerListeners() {
    window.addEventListener('pointermove', (e) => {
      if (activeDragInfo) {
        handleEdgeDragMove(e);
      }
      if (activeRowDrag) {
        handleRowDragMove(e);
      }
      if (activeColResize) {
        handleColResizeMove(e);
      }
    });

    window.addEventListener('pointerup', (e) => {
      if (activeDragInfo) {
        handleEdgeDragEnd(e);
      }
      if (activeRowDrag) {
        handleRowDragEnd();
      }
      if (activeColResize) {
        handleColResizeEnd();
      }
    });
  }

  // --- Master Render Function ---
  function renderAll() {
    renderTimelineRuler();
    renderTable();
  }

  // Expose public API on window
  window.app = {
    addRow,
    loadSampleData,
    duplicateRow,
    deleteRow,
    exportJson,
    exportSvgDiagram,
    exportPngDiagram,
    exportPdfDiagram,
    toggleTheme,
    setAppMode,
    toggleVoltageColumn,
    toggleTypeColumn,
    state
  };

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
