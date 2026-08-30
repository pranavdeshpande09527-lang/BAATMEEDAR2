/**
 * BAATMEEDAR — The Gatekeeper of Truth
 * Frontend Client Application — Multi-Page Newspaper Architecture
 * 8 dedicated editorial pages with clean navigation
 */

(function () {
  'use strict';

  // ── STATE ─────────────────────────────────────────────────────────────────
  let currentMode = 'TEXT';
  let activeCheckId = null;
  let activeCheckData = null;
  let pollInterval = null;
  let currentPage = 'input';
  let evidenceFilter = 'ALL';

  // ── DOM ELEMENTS: FORM ────────────────────────────────────────────────────
  const form          = document.getElementById('verification-form');
  const btnDispatch   = document.getElementById('btn-dispatch');
  const tabs          = document.querySelectorAll('.mode-tab');
  const groupText     = document.getElementById('group-text');
  const groupArticle  = document.getElementById('group-article');
  const groupYoutube  = document.getElementById('group-youtube');
  const inputText     = document.getElementById('input-text');
  const inputArticle  = document.getElementById('input-article');
  const inputYoutube  = document.getElementById('input-youtube');
  const sampleBtns    = document.querySelectorAll('.sample-btn');

  // ── DOM ELEMENTS: NAVIGATION ──────────────────────────────────────────────
  const navTabs               = document.querySelectorAll('.nav-tab');
  const pageViews             = document.querySelectorAll('.page-view');
  const dossierContextBar     = document.getElementById('dossier-context-bar');
  const dossierIdDisplay      = document.getElementById('dossier-id-display');
  const dossierTitleDisplay   = document.getElementById('dossier-title-display');
  const dossierStatusDisplay  = document.getElementById('dossier-status-display');
  const btnNewDispatchQuick   = document.getElementById('btn-new-dispatch-quick');
  const btnJumpToVerdict      = document.getElementById('btn-jump-to-verdict');

  // ── DOM ELEMENTS: PROGRESS ────────────────────────────────────────────────
  const progressJobTag     = document.getElementById('progress-job-tag');
  const liveActivityText   = document.getElementById('live-activity-text');
  const progressBanner     = document.getElementById('progress-complete-banner');
  const badgeWire          = document.getElementById('badge-wire-status');
  const badgeVerdict       = document.getElementById('badge-verdict');
  const badgeClaimsCount   = document.getElementById('badge-claims-count');
  const badgeEvidenceCount = document.getElementById('badge-evidence-count');
  const claimsMetaCount    = document.getElementById('claims-meta-count');
  const evidenceMetaCount  = document.getElementById('evidence-meta-count');
  const liveDateDisplay    = document.getElementById('live-date-display');
  const stepBoxes = {
    1: document.getElementById('step-1'),
    2: document.getElementById('step-2'),
    3: document.getElementById('step-3'),
    4: document.getElementById('step-4'),
    5: document.getElementById('step-5'),
  };

  // ── DOM ELEMENTS: PAGE CONTENT CONTAINERS ─────────────────────────────────
  const verdictContent  = document.getElementById('page-verdict-content');
  const claimsContent   = document.getElementById('page-claims-content');
  const evidenceContent = document.getElementById('page-evidence-content');
  const grokContent     = document.getElementById('page-grok-content');
  const geminiContent   = document.getElementById('page-gemini-content');
  const rawContent      = document.getElementById('page-raw-content');

  // ── DOM ELEMENTS: ARCHIVES ─────────────────────────────────────────────────
  const btnToggleArchive    = document.getElementById('btn-toggle-archive');
  const btnCloseArchive     = document.getElementById('btn-close-archive');
  const archivesPanel       = document.getElementById('archives-panel');
  const archiveListContainer = document.getElementById('archive-list-container');

  // ── INITIALIZATION ────────────────────────────────────────────────────────
  function init() {
    updateMastheadDate();
    bindEvents();
    checkUrlParams();
  }

  function updateMastheadDate() {
    const now = new Date();
    const opts = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    if (liveDateDisplay) {
      liveDateDisplay.textContent = now.toLocaleDateString('en-GB', opts).toUpperCase();
    }
  }

  // ── EVENT BINDINGS ────────────────────────────────────────────────────────
  function bindEvents() {
    // Section navigation tabs
    navTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const page = tab.getAttribute('data-page');
        navigateToPage(page);
      });
    });

    // Page-footer prev/next navigation
    document.querySelectorAll('.page-nav-link').forEach(btn => {
      btn.addEventListener('click', () => {
        const page = btn.getAttribute('data-page');
        if (page) navigateToPage(page);
      });
    });

    // Verdict deep-dive cards (delegated)
    document.addEventListener('click', e => {
      const card = e.target.closest('.deep-dive-card');
      if (card) {
        const page = card.getAttribute('data-page');
        if (page) navigateToPage(page);
      }
    });

    // Input mode tabs
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        switchMode(tab.getAttribute('data-mode'));
      });
    });

    // Sample prompt buttons
    sampleBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-type');
        const text = btn.getAttribute('data-text');
        switchMode(mode);
        if (mode === 'TEXT') inputText.value = text;
        if (mode === 'ARTICLE') inputArticle.value = text;
        if (mode === 'YOUTUBE') inputYoutube.value = text;
      });
    });

    // Form submission
    form.addEventListener('submit', handleDispatchSubmit);

    // Jump to verdict from progress banner
    if (btnJumpToVerdict) btnJumpToVerdict.addEventListener('click', () => navigateToPage('verdict'));

    // Dossier: new dispatch quick button
    if (btnNewDispatchQuick) btnNewDispatchQuick.addEventListener('click', () => navigateToPage('input'));

    // Archive drawer
    btnToggleArchive.addEventListener('click', () => {
      archivesPanel.classList.toggle('hidden');
      if (!archivesPanel.classList.contains('hidden')) loadArchives();
    });
    btnCloseArchive.addEventListener('click', () => archivesPanel.classList.add('hidden'));

    // Evidence filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        evidenceFilter = btn.getAttribute('data-filter');
        if (activeCheckData) renderEvidenceSources(activeCheckData);
      });
    });

    // Browser back/forward navigation
    window.addEventListener('popstate', () => {
      const params = new URLSearchParams(window.location.search);
      const page = params.get('page') || 'input';
      const checkId = params.get('checkId');
      setActivePage(page);
      if (checkId && checkId !== activeCheckId) loadCheckById(checkId);
    });
  }

  // ── PAGE NAVIGATION ───────────────────────────────────────────────────────
  function navigateToPage(pageId) {
    setActivePage(pageId);

    // Update URL
    const params = new URLSearchParams(window.location.search);
    params.set('page', pageId);
    window.history.pushState({}, '', `?${params.toString()}`);

    // Re-render the target page if we have data
    if (activeCheckData) {
      renderPageContent(pageId, activeCheckData);
    }
  }

  function setActivePage(pageId) {
    currentPage = pageId;

    // Activate correct page view
    pageViews.forEach(v => v.classList.toggle('active', v.id === `page-${pageId}`));

    // Update nav tab active state
    navTabs.forEach(t => t.classList.toggle('active', t.getAttribute('data-page') === pageId));

    // Scroll to top of page
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderPageContent(pageId, check) {
    switch (pageId) {
      case 'verdict':  renderFinalVerdict(check);     break;
      case 'claims':   renderClaimsBreakdown(check);  break;
      case 'evidence': renderEvidenceSources(check);  break;
      case 'grok':     renderGrokDesk(check);         break;
      case 'gemini':   renderGeminiDesk(check);       break;
      case 'raw':      renderRawIntake(check);        break;
    }
  }

  // ── DOSSIER CONTEXT BAR ───────────────────────────────────────────────────
  function updateDossierBar(check) {
    if (!check) {
      dossierContextBar.classList.add('hidden');
      return;
    }
    dossierContextBar.classList.remove('hidden');
    dossierIdDisplay.textContent = `#${check.id.substring(0, 8).toUpperCase()}`;
    const title = check.sourceTitle || (check.originalInput ? check.originalInput.substring(0, 70) + '…' : 'Untitled Dispatch');
    dossierTitleDisplay.textContent = title;
    dossierStatusDisplay.textContent = `STATUS: ${check.status}`;
  }

  // ── MODE SWITCHING ────────────────────────────────────────────────────────
  function switchMode(mode) {
    currentMode = mode;
    tabs.forEach(t => t.classList.toggle('active', t.getAttribute('data-mode') === mode));
    groupText.classList.toggle('hidden', mode !== 'TEXT');
    groupArticle.classList.toggle('hidden', mode !== 'ARTICLE');
    groupYoutube.classList.toggle('hidden', mode !== 'YOUTUBE');

    inputText.removeAttribute('required');
    inputArticle.removeAttribute('required');
    inputYoutube.removeAttribute('required');
    if (mode === 'TEXT') inputText.setAttribute('required', 'required');
    if (mode === 'ARTICLE') inputArticle.setAttribute('required', 'required');
    if (mode === 'YOUTUBE') inputYoutube.setAttribute('required', 'required');
  }

  function checkUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const checkId = params.get('checkId');
    const page    = params.get('page') || 'input';
    setActivePage(page);
    if (checkId) loadCheckById(checkId);
  }

  // ── FORM SUBMISSION ───────────────────────────────────────────────────────
  async function handleDispatchSubmit(e) {
    e.preventDefault();

    let inputValue = '';
    if (currentMode === 'TEXT') inputValue = inputText.value.trim();
    if (currentMode === 'ARTICLE') inputValue = inputArticle.value.trim();
    if (currentMode === 'YOUTUBE') inputValue = inputYoutube.value.trim();

    if (!inputValue) {
      alert('Please provide a statement or URL to verify.');
      return;
    }

    try {
      btnDispatch.disabled = true;
      btnDispatch.textContent = 'TRANSMITTING DISPATCH TO NEWSROOM...';

      const response = await fetch('/checks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputType: currentMode, input: inputValue }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || (errData.errors && errData.errors[0].msg) || 'Submission failed');
      }

      const data = await response.json();
      activeCheckId = data.checkId;

      // Push URL then navigate to progress page
      const params = new URLSearchParams({ checkId: activeCheckId, page: 'progress' });
      window.history.pushState({}, '', `?${params.toString()}`);
      setActivePage('progress');

      startPolling(activeCheckId);

    } catch (err) {
      alert(`Submission error: ${err.message}`);
      btnDispatch.disabled = false;
      btnDispatch.textContent = 'DISPATCH TO NEWSROOM FOR VERIFICATION';
    }
  }

  // ── POLLING & STATUS TRACKING ─────────────────────────────────────────────
  function startPolling(checkId) {
    if (pollInterval) clearInterval(pollInterval);

    progressJobTag.textContent = `JOB: #${checkId.substring(0, 8).toUpperCase()}`;
    badgeWire.classList.remove('hidden');
    progressBanner.classList.add('hidden');

    resetStepper();
    pollOnce(checkId);
    pollInterval = setInterval(() => pollOnce(checkId), 1800);
  }

  async function pollOnce(checkId) {
    try {
      const res = await fetch(`/checks/${checkId}`);
      if (!res.ok) throw new Error('Failed to retrieve verification progress');
      const check = await res.json();

      activeCheckData = check;
      updateDossierBar(check);
      updatePipelineUI(check);
      updateNavBadges(check);

      // Re-render the currently visible page if it isn't input/progress
      if (currentPage !== 'input' && currentPage !== 'progress') {
        renderPageContent(currentPage, check);
      }

      if (check.status === 'COMPLETE' || check.status === 'FAILED') {
        clearInterval(pollInterval);
        badgeWire.classList.add('hidden');
        btnDispatch.disabled = false;
        btnDispatch.textContent = 'DISPATCH TO NEWSROOM FOR VERIFICATION';

        if (check.status === 'COMPLETE') {
          progressBanner.classList.remove('hidden');
          badgeVerdict.classList.remove('hidden');
          // Pre-render all pages now data is complete
          renderAllPages(check);
        }
      }
    } catch (err) {
      console.error('[Polling Error]', err);
    }
  }

  function renderAllPages(check) {
    renderFinalVerdict(check);
    renderClaimsBreakdown(check);
    renderEvidenceSources(check);
    renderGrokDesk(check);
    renderGeminiDesk(check);
    renderRawIntake(check);
  }

  function resetStepper() {
    for (let i = 1; i <= 5; i++) {
      const box = stepBoxes[i];
      box.className = 'step-box';
      box.querySelector('.step-status').textContent = 'QUEUED';
    }
  }

  function updatePipelineUI(check) {
    const status = check.status;
    let currentStepNum = 1;
    let activityNote = 'Intake received. Activating pipeline stages...';

    if (status === 'PENDING' || status === 'INGESTING') {
      currentStepNum = 1;
      activityNote = `Stage 1: Ingesting ${check.inputType} payload and extracting textual content...`;
    } else if (status === 'EXTRACTING_CLAIMS') {
      currentStepNum = 2;
      activityNote = 'Stage 2: Decomposing source text into atomic factual propositions...';
    } else if (status === 'RESEARCHING') {
      currentStepNum = 3;
      activityNote = 'Stage 3: Sourcing primary web evidence, checking credibility and context...';
    } else if (status === 'VERIFYING') {
      currentStepNum = 4;
      activityNote = 'Stage 4: Running dual-blind isolated Grok and Gemini evaluator deliberations...';
    } else if (status === 'COMPLETE') {
      currentStepNum = 5;
      activityNote = 'Stage 5 complete. All verification stages published to editorial dossier.';
    } else if (status === 'FAILED') {
      activityNote = 'Newsroom pipeline stopped due to an extraction or processing failure.';
    }

    liveActivityText.textContent = activityNote;

    for (let i = 1; i <= 5; i++) {
      const box = stepBoxes[i];
      const statusEl = box.querySelector('.step-status');
      if (status === 'FAILED' && i === currentStepNum) {
        box.className = 'step-box failed';
        statusEl.textContent = 'FAILED';
      } else if (i < currentStepNum || status === 'COMPLETE') {
        box.className = 'step-box completed';
        statusEl.textContent = 'DONE';
      } else if (i === currentStepNum) {
        box.className = 'step-box active';
        statusEl.textContent = 'ACTIVE';
      } else {
        box.className = 'step-box';
        statusEl.textContent = 'QUEUED';
      }
    }
  }

  function updateNavBadges(check) {
    const claims = check.claims || [];
    const claimsCount = claims.length;
    let sourcesCount = 0;
    claims.forEach(c => { sourcesCount += (c.sources || []).length; });

    if (claimsCount > 0) {
      badgeClaimsCount.textContent = `(${claimsCount})`;
      badgeClaimsCount.classList.remove('hidden');
      claimsMetaCount.textContent = `${claimsCount} PROPOSITION${claimsCount !== 1 ? 'S' : ''}`;
    }
    if (sourcesCount > 0) {
      badgeEvidenceCount.textContent = `(${sourcesCount})`;
      badgeEvidenceCount.classList.remove('hidden');
      evidenceMetaCount.textContent = `${sourcesCount} SOURCE${sourcesCount !== 1 ? 'S' : ''}`;
    }
  }

  // ── PAGE 3: FINAL VERDICT ─────────────────────────────────────────────────
  function renderFinalVerdict(check) {
    const claims = check.claims || [];
    const isComplete = check.status === 'COMPLETE';

    if (!isComplete && claims.length === 0) {
      verdictContent.innerHTML = `<div class="placeholder-card"><p>Editorial synthesis awaiting completion of pipeline stages...</p></div>`;
      return;
    }

    let supporting = 0, contradicting = 0, insufficient = 0;
    const uncertainties = [];
    let grokVerdict = null, geminiVerdict = null;
    let grokConfidence = null, geminiConfidence = null;

    claims.forEach(c => {
      (c.sources || []).forEach(s => {
        const st = (s.stance || '').toUpperCase();
        if (st.includes('SUPPORT')) supporting++;
        else if (st.includes('CONTRADICT')) contradicting++;
        else insufficient++;
      });

      (c.evidenceReviews || []).forEach(r => {
        if (r.unansweredQuestions) uncertainties.push(`Claim #${c.claimOrder || 1}: ${r.unansweredQuestions}`);
        if (r.missingContext) uncertainties.push(`Claim #${c.claimOrder || 1}: ${r.missingContext}`);
      });

      (c.verifications || []).forEach(v => {
        if (v.limitations) uncertainties.push(`${v.modelName} note on Claim #${c.claimOrder || 1}: ${v.limitations}`);
        if (v.modelName === 'GROK') { grokVerdict = v.verdict; grokConfidence = v.confidence; }
        if (v.modelName === 'GEMINI') { geminiVerdict = v.verdict; geminiConfidence = v.confidence; }
      });

      if (c.ambiguityNotes) uncertainties.push(`Claim #${c.claimOrder || 1} ambiguity: ${c.ambiguityNotes}`);
    });

    // Overall verdict
    let primaryVerdict = 'INCONCLUSIVE';
    let verdictClass = 'inconclusive';
    if (supporting > 0 && contradicting === 0) {
      primaryVerdict = 'SUPPORTED BY SOURCED EVIDENCE'; verdictClass = 'supported';
    } else if (contradicting > 0 && supporting === 0) {
      primaryVerdict = 'CONTRADICTED BY SOURCED EVIDENCE'; verdictClass = 'contradicted';
    } else if (supporting > 0 && contradicting > 0) {
      primaryVerdict = 'INCONCLUSIVE — CONFLICTING EVIDENCE'; verdictClass = 'contradicted';
    } else if (isComplete) {
      primaryVerdict = 'INCONCLUSIVE — INSUFFICIENT EVIDENCE'; verdictClass = 'inconclusive';
    } else {
      primaryVerdict = 'DELIBERATION IN PROGRESS'; verdictClass = 'inconclusive';
    }

    // Consensus
    const hasAgreement = grokVerdict && geminiVerdict && grokVerdict === geminiVerdict;
    const hasDisagreement = grokVerdict && geminiVerdict && grokVerdict !== geminiVerdict;
    let consensusHtml = '';
    if (hasAgreement) {
      consensusHtml = `
        <div class="consensus-lead-banner agreement">
          <span>DUAL-BLIND CONSENSUS: BOTH EVALUATORS INDEPENDENTLY RETURNED [${escapeHtml(grokVerdict)}]</span>
          <span>RIGOUR VALIDATED</span>
        </div>`;
    } else if (hasDisagreement) {
      consensusHtml = `
        <div class="consensus-lead-banner divergence">
          <span>EVALUATOR DISAGREEMENT: GROK [${escapeHtml(grokVerdict)}] vs GEMINI [${escapeHtml(geminiVerdict)}]</span>
          <span>EDITORIAL RULE: RESOLVED AS INCONCLUSIVE</span>
        </div>`;
    }

    const summaryText = `BAATMEEDAR's multi-agent newsroom evaluated ${claims.length} atomic proposition${claims.length !== 1 ? 's' : ''} from the intake dispatch against ${supporting + contradicting + insufficient} inspected primary source${(supporting + contradicting + insufficient) !== 1 ? 's' : ''} under dual-blind verification. The evidence indicates an overall finding of <strong>${escapeHtml(primaryVerdict)}</strong>.${grokConfidence ? ` Evaluator A (Grok) confidence: ${Math.round(grokConfidence * 100)}%.` : ''}${geminiConfidence ? ` Evaluator B (Gemini) confidence: ${Math.round(geminiConfidence * 100)}%.` : ''}`;

    const uncertaintyItems = uncertainties.length > 0
      ? uncertainties.slice(0, 6).map(u => `<li>${escapeHtml(u)}</li>`).join('')
      : `<li>No critical unaddressed ambiguities were detected in the inspected source material.</li>
         <li>Findings remain bounded by sources available at retrieval time (${new Date(check.createdAt).toLocaleDateString('en-GB')}).</li>`;

    verdictContent.innerHTML = `
      <div class="verdict-lead-block">
        <div class="verdict-header-split">
          <div class="verdict-stamp ${verdictClass}">VERDICT: ${escapeHtml(primaryVerdict)}</div>
          <div class="verdict-tally-grid">
            <div class="tally-item">SUPPORTING: ${supporting}</div>
            <div class="tally-item ${contradicting > 0 ? 'alert-red' : ''}">CONTRADICTING: ${contradicting}</div>
            <div class="tally-item">INSUFFICIENT: ${insufficient}</div>
          </div>
        </div>

        ${consensusHtml}

        <div class="editorial-lead-summary">${summaryText}</div>

        <div class="verdict-uncertainties-card">
          <div class="uncertainties-head">REMAINING UNCERTAINTIES &amp; SCOPE LIMITATIONS</div>
          <ul class="uncertainties-items">${uncertaintyItems}</ul>
        </div>
      </div>

      <div class="verdict-deep-dives">
        <div class="deep-dives-head">INSPECT SUPPORTING EVIDENCE &amp; FULL DELIBERATIONS</div>
        <div class="deep-dives-grid">
          <div class="deep-dive-card" data-page="claims">
            <div>
              <div class="deep-dive-kicker">Stage 2 &bull; Factual Dissection</div>
              <div class="deep-dive-title">Claim Breakdown (${claims.length})</div>
            </div>
            <div class="deep-dive-arrow">INSPECT ↗</div>
          </div>
          <div class="deep-dive-card" data-page="evidence">
            <div>
              <div class="deep-dive-kicker">Stage 3 &bull; Citations &amp; Excerpts</div>
              <div class="deep-dive-title">Evidence Sources (${supporting + contradicting + insufficient})</div>
            </div>
            <div class="deep-dive-arrow">INSPECT ↗</div>
          </div>
          <div class="deep-dive-card" data-page="grok">
            <div>
              <div class="deep-dive-kicker">Stage 4A &bull; Independent Evaluator A</div>
              <div class="deep-dive-title">Grok Fact Desk Deliberations</div>
            </div>
            <div class="deep-dive-arrow">INSPECT ↗</div>
          </div>
          <div class="deep-dive-card" data-page="gemini">
            <div>
              <div class="deep-dive-kicker">Stage 4B &bull; Independent Evaluator B</div>
              <div class="deep-dive-title">Gemini Fact Desk Deliberations</div>
            </div>
            <div class="deep-dive-arrow">INSPECT ↗</div>
          </div>
        </div>
      </div>
    `;
  }

  // ── PAGE 4: CLAIM BREAKDOWN ────────────────────────────────────────────────
  function renderClaimsBreakdown(check) {
    const claims = check.claims || [];

    if (claims.length === 0) {
      claimsContent.innerHTML = `<div class="placeholder-card"><p>Extracting atomic propositions from source text...</p></div>`;
      return;
    }

    let html = '';
    claims.forEach((claim, idx) => {
      let entities = [];
      try {
        entities = typeof claim.namedEntities === 'string' ? JSON.parse(claim.namedEntities) : (claim.namedEntities || []);
      } catch (e) { entities = []; }

      html += `
        <div class="claim-card">
          <div class="claim-card-head">
            <div class="claim-kicker">CLAIM #${String(claim.claimOrder || (idx + 1)).padStart(2, '0')}</div>
            <div class="claim-badges-row">
              <span class="badge ${claim.isVerifiable ? 'verifiable' : 'non-verifiable'}">
                ${claim.isVerifiable ? '[ VERIFIABLE PROPOSITION ]' : '[ OPINION / SUBJECTIVE ]'}
              </span>
              ${claim.domain ? `<span class="badge">[ DOMAIN: ${escapeHtml(claim.domain)} ]</span>` : ''}
              <span class="badge">[ ${escapeHtml(claim.importance || 'MEDIUM')} IMPORTANCE ]</span>
            </div>
          </div>

          <div class="claim-main-text">&ldquo;${escapeHtml(claim.claimText)}&rdquo;</div>

          ${claim.originalWording && claim.originalWording !== claim.claimText
            ? `<div class="claim-verbatim-text">Verbatim source wording: &ldquo;${escapeHtml(claim.originalWording)}&rdquo;</div>`
            : ''}

          <div class="claim-meta-details-grid">
            <div class="meta-field"><strong>TIME REFERENCE:</strong> ${escapeHtml(claim.timeReference || 'UNSPECIFIED')}</div>
            <div class="meta-field"><strong>TIME SENSITIVITY:</strong> ${escapeHtml(claim.timeSensitivity || 'GENERAL')}</div>
            <div class="meta-field"><strong>NAMED ENTITIES:</strong> ${entities.length ? escapeHtml(entities.join(', ')) : 'NONE SPECIFIED'}</div>
            ${claim.materialContext ? `<div class="meta-field" style="grid-column: 1 / -1"><strong>MATERIAL CONTEXT:</strong> ${escapeHtml(claim.materialContext)}</div>` : ''}
            ${claim.ambiguityNotes ? `<div class="meta-field" style="grid-column: 1 / -1; color: var(--accent-red)"><strong>AMBIGUITY FLAGS:</strong> ${escapeHtml(claim.ambiguityNotes)}</div>` : ''}
          </div>
        </div>
      `;
    });

    claimsContent.innerHTML = html;
  }

  // ── PAGE 5: EVIDENCE SOURCES ───────────────────────────────────────────────
  function renderEvidenceSources(check) {
    const claims = check.claims || [];
    let allSources = [];

    claims.forEach(c => {
      (c.sources || []).forEach(s => allSources.push({ ...s, claimText: c.claimText, claimOrder: c.claimOrder }));
    });

    if (allSources.length === 0) {
      evidenceContent.innerHTML = `<div class="placeholder-card"><p>Retrieving primary evidence from web sources...</p></div>`;
      return;
    }

    // Apply filter
    const filtered = evidenceFilter === 'ALL' ? allSources : allSources.filter(s => {
      const st = (s.stance || '').toUpperCase();
      return st.includes(evidenceFilter);
    });

    if (filtered.length === 0) {
      evidenceContent.innerHTML = `<div class="placeholder-card"><p>No sources match the selected stance filter.</p></div>`;
      return;
    }

    let html = '';
    filtered.forEach(s => {
      const stance = (s.stance || 'INSUFFICIENT').toUpperCase();
      let stanceClass = 'insufficient';
      if (stance.includes('SUPPORT')) stanceClass = 'supports';
      if (stance.includes('CONTRADICT')) stanceClass = 'contradicts';

      html += `
        <div class="evidence-card">
          <div class="evidence-head-row">
            <span class="evidence-publisher">${escapeHtml(s.publisher || 'NEWS DESK')}${s.author ? ` &bull; BY ${escapeHtml(s.author)}` : ''}</span>
            <span class="source-stance-tag ${stanceClass}">[ STANCE: ${escapeHtml(stance)} ]</span>
          </div>

          <a href="${escapeHtml(s.url)}" target="_blank" rel="noreferrer" class="evidence-title-link">
            ${escapeHtml(s.title || s.url)} ↗
          </a>

          ${(s.relevantExcerpt || s.searchSnippet) ? `
            <div class="evidence-quote-box">
              &ldquo;${escapeHtml(s.relevantExcerpt || s.searchSnippet)}&rdquo;
            </div>
          ` : ''}

          <div class="evidence-meta-row">
            <span><strong>CLAIM:</strong> #${s.claimOrder || 1} &bull; ${escapeHtml(s.claimText)}</span>
            ${s.authorityRationale ? `<span><strong>AUTHORITY:</strong> ${escapeHtml(s.authorityRationale)}</span>` : ''}
            ${s.publicationDate ? `<span><strong>PUBLISHED:</strong> ${escapeHtml(s.publicationDate)}</span>` : ''}
          </div>
        </div>
      `;
    });

    evidenceContent.innerHTML = html;
  }

  // ── PAGE 6: GROK EVALUATOR DESK ────────────────────────────────────────────
  function renderGrokDesk(check) {
    renderEvaluatorDesk(check, 'GROK', grokContent);
  }

  // ── PAGE 7: GEMINI EVALUATOR DESK ─────────────────────────────────────────
  function renderGeminiDesk(check) {
    renderEvaluatorDesk(check, 'GEMINI', geminiContent);
  }

  function renderEvaluatorDesk(check, modelName, container) {
    const claims = check.claims || [];
    let hasAny = false;

    let html = '';
    claims.forEach(claim => {
      const verif = (claim.verifications || []).find(v => v.modelName === modelName);
      if (!verif) return;
      hasAny = true;

      const verdict = verif.verdict || 'INCONCLUSIVE';
      let verdictClass = '';
      if (verdict.toUpperCase().includes('SUPPORT')) verdictClass = 'supported';
      if (verdict.toUpperCase().includes('CONTRADICT')) verdictClass = 'contradicted';

      html += `
        <div class="evaluator-claim-block">
          <div class="evaluator-claim-header">
            <div class="claim-kicker">CLAIM #${claim.claimOrder || 1}: &ldquo;${escapeHtml(claim.claimText)}&rdquo;</div>
          </div>

          <div class="evaluator-status-ribbon">
            <span><strong>VERDICT:</strong> <span class="source-stance-tag ${verdictClass}">${escapeHtml(verdict)}</span></span>
            <span><strong>CONFIDENCE:</strong> ${verif.confidence !== null ? `${Math.round(verif.confidence * 100)}%` : '—'}</span>
            <span><strong>STATUS:</strong> DELIBERATION COMPLETE</span>
          </div>

          <div class="evaluator-reasoning-body">${escapeHtml(verif.reasoning || 'Deliberation reasoning not available.')}</div>

          ${verif.limitations ? `
            <div class="evaluator-notes-card">
              <div class="evaluator-notes-head">LIMITATIONS NOTED BY EVALUATOR</div>
              <div class="evaluator-notes-text">${escapeHtml(verif.limitations)}</div>
            </div>
          ` : ''}

          ${verif.unresolvedQuestions ? `
            <div class="evaluator-notes-card" style="margin-top: 10px;">
              <div class="evaluator-notes-head">UNRESOLVED QUESTIONS</div>
              <div class="evaluator-notes-text">${escapeHtml(verif.unresolvedQuestions)}</div>
            </div>
          ` : ''}
        </div>
      `;
    });

    if (!hasAny) {
      container.innerHTML = `<div class="placeholder-card"><p>Conducting ${modelName} deliberations...</p></div>`;
      return;
    }
    container.innerHTML = html;
  }

  // ── PAGE 8: RAW INTAKE & TECHNICAL DETAILS ─────────────────────────────────
  function renderRawIntake(check) {
    const wordCount = check.extractedText ? check.extractedText.trim().split(/\s+/).length : 0;
    const charCount = check.extractedText ? check.extractedText.length : 0;
    const apiLogs   = check.apiUsageLogs || [];
    const totalTokens = apiLogs.reduce((s, l) => s + (l.tokensUsed || 0), 0);
    const totalCost   = apiLogs.reduce((s, l) => s + (l.costEstimate || 0), 0);
    const callCount   = apiLogs.length;

    // Provider breakdown
    const byProvider = {};
    apiLogs.forEach(l => { byProvider[l.provider] = (byProvider[l.provider] || 0) + (l.tokensUsed || 0); });

    // API usage table rows
    let apiTableRows = '';
    if (apiLogs.length > 0) {
      apiLogs.slice(0, 30).forEach(l => {
        apiTableRows += `
          <tr>
            <td>${escapeHtml(l.provider)}</td>
            <td>${escapeHtml(l.endpoint || '—')}</td>
            <td>${l.stage || '—'}</td>
            <td>${l.tokensUsed || '—'}</td>
            <td>${l.latencyMs ? l.latencyMs + ' ms' : '—'}</td>
            <td>${l.wasFromCache ? 'CACHE HIT' : 'LIVE CALL'}</td>
            <td>${l.success ? 'OK' : 'ERROR'}</td>
          </tr>`;
      });
    } else {
      apiTableRows = `<tr><td colspan="7" style="text-align:center;color:var(--ink-muted)">No API usage logs available. This may require a fresh check query.</td></tr>`;
    }

    const providerSummary = Object.entries(byProvider)
      .map(([p, t]) => `<div class="meta-field"><strong>${escapeHtml(p.toUpperCase())}:</strong> ${t.toLocaleString()} TOKENS</div>`)
      .join('');

    rawContent.innerHTML = `
      <!-- Intake Metadata Card -->
      <div class="provenance-card">
        <div class="provenance-head">SOURCE INTAKE RECORD &bull; STAGE 1 PROVENANCE</div>
        <div class="provenance-grid">
          <div class="meta-field"><strong>INTAKE TYPE:</strong> ${escapeHtml(check.inputType)}</div>
          <div class="meta-field"><strong>PIPELINE STATUS:</strong> ${escapeHtml(check.status)}</div>
          <div class="meta-field"><strong>JOB ID:</strong> ${escapeHtml(check.id)}</div>
          <div class="meta-field"><strong>CREATED:</strong> ${new Date(check.createdAt).toLocaleString()}</div>
          ${check.sourceTitle ? `<div class="meta-field"><strong>SOURCE TITLE:</strong> ${escapeHtml(check.sourceTitle)}</div>` : ''}
          ${check.canonicalUrl ? `<div class="meta-field"><strong>CANONICAL URL:</strong> <a href="${escapeHtml(check.canonicalUrl)}" target="_blank" rel="noreferrer" class="text-link-btn">OPEN LINK ↗</a></div>` : ''}
          ${check.videoId ? `<div class="meta-field"><strong>YOUTUBE VIDEO ID:</strong> ${escapeHtml(check.videoId)}</div>` : ''}
          <div class="meta-field"><strong>WORD COUNT:</strong> ${wordCount.toLocaleString()} WORDS</div>
          <div class="meta-field"><strong>CHARACTER COUNT:</strong> ${charCount.toLocaleString()} CHARS</div>
        </div>

        <div class="meta-field" style="margin-bottom:6px"><strong>EXTRACTED TEXT / TRANSCRIPT PREVIEW:</strong></div>
        <div class="raw-text-viewer">${escapeHtml(check.extractedText || check.originalInput || 'No extracted text available yet.')}</div>
      </div>

      <!-- API Usage Summary -->
      <div class="provenance-card">
        <div class="provenance-head">API USAGE AUDIT TRAIL &bull; PIPELINE TELEMETRY</div>
        <div class="provenance-grid">
          <div class="meta-field"><strong>TOTAL API CALLS:</strong> ${callCount}</div>
          <div class="meta-field"><strong>TOTAL TOKENS:</strong> ${totalTokens.toLocaleString()}</div>
          <div class="meta-field"><strong>ESTIMATED COST:</strong> $${totalCost.toFixed(6)}</div>
          ${providerSummary}
        </div>
      </div>

      <!-- Full Call Log Table -->
      <div class="provenance-card">
        <div class="provenance-head">FULL API CALL LOG</div>
        <div style="overflow-x:auto">
          <table class="telemetry-table">
            <thead>
              <tr>
                <th>PROVIDER</th>
                <th>ENDPOINT</th>
                <th>STAGE</th>
                <th>TOKENS</th>
                <th>LATENCY</th>
                <th>SOURCE</th>
                <th>RESULT</th>
              </tr>
            </thead>
            <tbody>
              ${apiTableRows}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ── ARCHIVES LOADER ───────────────────────────────────────────────────────
  async function loadArchives() {
    try {
      archiveListContainer.innerHTML = '<p class="empty-archive-note">Loading archived verifications...</p>';
      const res = await fetch('/checks');
      if (!res.ok) throw new Error('Failed to load past editions');
      const checks = await res.json();

      if (checks.length === 0) {
        archiveListContainer.innerHTML = '<p class="empty-archive-note">No prior verification editions recorded in the newsroom yet.</p>';
        return;
      }

      let html = '';
      checks.forEach(c => {
        const excerpt = c.originalInput ? c.originalInput.substring(0, 120) + (c.originalInput.length > 120 ? '...' : '') : 'Untitled dispatch';
        const claimsCount = c.claims ? c.claims.length : 0;
        const dateStr = new Date(c.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

        html += `
          <div class="archive-item">
            <div class="archive-item-main">
              <div class="archive-title">${escapeHtml(c.sourceTitle || excerpt)}</div>
              <div class="archive-meta">${dateStr} &bull; ${escapeHtml(c.inputType)} &bull; ${claimsCount} CLAIM${claimsCount !== 1 ? 'S' : ''} &bull; ${escapeHtml(c.status)}</div>
            </div>
            <button class="text-link-btn" onclick="window.BAATMEEDAR.loadCheck('${c.id}')">[ INSPECT EDITION ↗ ]</button>
          </div>
        `;
      });
      archiveListContainer.innerHTML = html;
    } catch (err) {
      archiveListContainer.innerHTML = `<p class="empty-archive-note">Error loading archives: ${escapeHtml(err.message)}</p>`;
    }
  }

  async function loadCheckById(id) {
    activeCheckId = id;

    // Update URL
    const params = new URLSearchParams(window.location.search);
    params.set('checkId', id);
    if (!params.get('page')) params.set('page', 'verdict');
    window.history.pushState({}, '', `?${params.toString()}`);

    startPolling(id);

    // Navigate to verdict (or stay on current page if explicitly set)
    const curPage = new URLSearchParams(window.location.search).get('page') || 'verdict';
    setActivePage(curPage);

    archivesPanel.classList.add('hidden');
  }

  // ── UTILITIES ─────────────────────────────────────────────────────────────
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Global exposure for archive click handlers
  window.BAATMEEDAR = { loadCheck: loadCheckById };

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
