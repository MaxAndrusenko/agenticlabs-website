/* ==========================================================================
   Agentic Labs — main.js
   Single vanilla-JS behavior file shared across every page.
   No dependencies. Loaded with <script src="…/js/main.js" defer>.
   Every feature feature-detects its DOM hooks and no-ops if they are absent,
   so this one file can safely load on all pages of the multi-page site.
   ========================================================================== */
(function () {
  'use strict';

  // Small helpers ----------------------------------------------------------
  var $  = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) {
    return Array.prototype.slice.call((ctx || document).querySelectorAll(sel));
  };
  var prefersReducedMotion = function () {
    return window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  };

  /* ------------------------------------------------------------------------
     1) MOBILE NAV TOGGLE
     Hook: <button class="al-navbar__toggle" data-nav-toggle
                   aria-expanded="false" aria-controls="al-mobile-menu">
           <nav|div class="al-mobile-menu" id="al-mobile-menu">…links…</nav>
     Behaviour: toggles .is-open on the menu, flips aria-expanded, locks body
     scroll while open, closes on link click + Escape.
     ------------------------------------------------------------------------ */
  function initMobileNav() {
    var toggle = $('[data-nav-toggle]');
    var menu   = document.getElementById('al-mobile-menu');
    if (!toggle || !menu) { return; } // no-op if absent

    function isOpen() { return menu.classList.contains('is-open'); }

    function openMenu() {
      menu.classList.add('is-open');
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-label', 'Close menu');
      document.body.classList.add('al-scroll-lock'); // CSS sets overflow:hidden
    }

    function closeMenu() {
      menu.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open menu');
      document.body.classList.remove('al-scroll-lock');
    }

    function toggleMenu() { isOpen() ? closeMenu() : openMenu(); }

    toggle.addEventListener('click', function (e) {
      e.preventDefault();
      toggleMenu();
    });

    // Close when any link inside the mobile menu is clicked.
    menu.addEventListener('click', function (e) {
      var link = e.target.closest ? e.target.closest('a') : null;
      if (link && menu.contains(link)) { closeMenu(); }
    });

    // Close on Escape (and return focus to the toggle for keyboard users).
    document.addEventListener('keydown', function (e) {
      if ((e.key === 'Escape' || e.key === 'Esc') && isOpen()) {
        closeMenu();
        toggle.focus();
      }
    });
  }

  /* ------------------------------------------------------------------------
     2) STICKY NAV BORDER
     Hook: .al-navbar  ->  gets .is-scrolled when window.scrollY > 40.
     Uses rAF throttling; runs once on load to set initial state.
     ------------------------------------------------------------------------ */
  function initStickyNav() {
    var navbar = $('.al-navbar');
    if (!navbar) { return; } // no-op if absent

    var ticking = false;

    function update() {
      var scrolled = (window.scrollY || window.pageYOffset || 0) > 40;
      navbar.classList.toggle('is-scrolled', scrolled);
      ticking = false;
    }

    function onScroll() {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(update);
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    update(); // set correct state on initial paint / reload mid-page
  }

  /* ------------------------------------------------------------------------
     3) ACCORDION
     Hooks: .al-accordion__trigger (real <button> with aria-expanded +
            aria-controls="PANEL_ID"); .al-accordion__panel#PANEL_ID.
     Behaviour: click toggles aria-expanded and animates panel height via
     max-height. Multiple items may be open at once. Keyboard-accessible for
     free because triggers are real buttons.
     ------------------------------------------------------------------------ */
  function initAccordion() {
    var triggers = $$('.al-accordion__trigger');
    if (!triggers.length) { return; } // no-op if absent

    var reduce = prefersReducedMotion();

    function panelFor(trigger) {
      var id = trigger.getAttribute('aria-controls');
      return id ? document.getElementById(id) : null;
    }

    function collapse(panel) {
      if (!panel) { return; }
      if (reduce) { panel.style.maxHeight = '0px'; panel.hidden = false; return; }
      // From its current expanded height, force a frame, then go to 0.
      panel.style.maxHeight = panel.scrollHeight + 'px';
      // Force reflow so the browser registers the start height.
      void panel.offsetHeight;
      panel.style.maxHeight = '0px';
    }

    function expand(panel) {
      if (!panel) { return; }
      if (reduce) { panel.style.maxHeight = 'none'; return; }
      panel.style.maxHeight = panel.scrollHeight + 'px';
      // After the transition, release the fixed height so nested/responsive
      // content can grow (e.g. on resize or font swap).
      var done = function (ev) {
        if (ev && ev.propertyName && ev.propertyName !== 'max-height') { return; }
        panel.style.maxHeight = 'none';
        panel.removeEventListener('transitionend', done);
      };
      panel.addEventListener('transitionend', done);
    }

    function setState(trigger, panel, open) {
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) { expand(panel); } else { collapse(panel); }
    }

    // Initialise each panel to match its trigger's declared state.
    triggers.forEach(function (trigger) {
      var panel = panelFor(trigger);
      var open = trigger.getAttribute('aria-expanded') === 'true';
      if (panel && !reduce) {
        panel.style.maxHeight = open ? 'none' : '0px';
      }
    });

    // Event delegation from the document so late-added items still work.
    document.addEventListener('click', function (e) {
      var trigger = e.target.closest ? e.target.closest('.al-accordion__trigger') : null;
      if (!trigger) { return; }
      e.preventDefault();
      var panel = panelFor(trigger);
      var open = trigger.getAttribute('aria-expanded') === 'true';
      setState(trigger, panel, !open);
    });

    // Keep any open panel sized correctly across viewport resizes.
    window.addEventListener('resize', function () {
      if (reduce) { return; }
      triggers.forEach(function (trigger) {
        if (trigger.getAttribute('aria-expanded') !== 'true') { return; }
        var panel = panelFor(trigger);
        if (panel) { panel.style.maxHeight = 'none'; }
      });
    }, { passive: true });
  }

  /* ------------------------------------------------------------------------
     4) SCROLL REVEAL
     Hook: .al-reveal -> gets .is-visible when it enters the viewport.
     Uses IntersectionObserver. If prefers-reduced-motion: reduce, or if IO is
     unsupported, add .is-visible immediately to all targets (no animation).
     A small per-element stagger is applied via inline transition-delay.
     ------------------------------------------------------------------------ */
  function initScrollReveal() {
    var targets = $$('.al-reveal');
    if (!targets.length) { return; } // no-op if absent

    // Reduced motion OR no IO support -> reveal everything immediately.
    if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
      targets.forEach(function (el) {
        el.classList.add('is-visible');
        runCountUps(el, true); // true = jump straight to final value
      });
      return;
    }

    var observer = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) { return; }
        var el = entry.target;
        // ~60ms stagger among siblings revealed in the same batch.
        var group = el.parentElement ? $$('.al-reveal', el.parentElement) : [el];
        var idx = group.indexOf(el);
        if (idx > 0) {
          var delay = idx * 60;
          el.style.transitionDelay = delay + 'ms';
          // Clear the stagger delay once the reveal has played, so it can't leak
          // into later transitions on the same element (e.g. a hover lift that
          // would otherwise feel laggy by up to the full stagger delay).
          window.setTimeout(function () { el.style.transitionDelay = ''; }, delay + 450);
        }
        el.classList.add('is-visible');
        runCountUps(el, false); // animate 0 -> value as the card comes alive
        obs.unobserve(el); // reveal once
      });
    }, { root: null, rootMargin: '0px 0px -10% 0px', threshold: 0.12 });

    targets.forEach(function (el) { observer.observe(el); });
  }

  /* Count-up helper for the case-study screens. Any [data-countup] inside a
     revealed element animates 0 -> data-to once. Honours data-prefix / data-suffix
     and data-sep (thousands separators). When `instant` (reduced motion / no IO),
     the final value is written immediately with no motion. Decorative numbers. */
  function runCountUps(root, instant) {
    var nodes = $$('[data-countup]', root);
    if (!nodes.length) { return; }
    nodes.forEach(function (node) {
      if (node.getAttribute('data-counted')) { return; } // once
      node.setAttribute('data-counted', '1');
      var to     = parseFloat(node.getAttribute('data-to')) || 0;
      var prefix = node.getAttribute('data-prefix') || '';
      var suffix = node.getAttribute('data-suffix') || '';
      var sep    = node.hasAttribute('data-sep');
      var format = function (n) {
        var s = String(n);
        if (sep) { s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
        return prefix + s + suffix;
      };
      if (instant) { node.textContent = format(to); return; }
      var dur = 700, start = null;
      function step(ts) {
        if (start === null) { start = ts; }
        var p = Math.min((ts - start) / dur, 1);
        var eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
        node.textContent = format(Math.round(to * eased));
        if (p < 1) { requestAnimationFrame(step); }
      }
      requestAnimationFrame(step);
    });
  }

  /* ------------------------------------------------------------------------
     5) STATIC FORM HANDLING
     Hook: form[data-al-form] with .al-field wrappers containing inputs and a
     sibling .al-field__error; success node = [data-form-success].
     Behaviour: on submit preventDefault, validate required fields + email
     format, mark invalid fields with .has-error + aria-invalid and show inline
     error text; if valid, hide the form and reveal the success node.
     (No backend — mimics Webflow native form behaviour.)
     ------------------------------------------------------------------------ */
  function initForms() {
    var forms = $$('form[data-al-form]');
    if (!forms.length) { return; } // no-op if absent

    var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    function fieldOf(control) {
      return control.closest ? control.closest('.al-field') : null;
    }

    function errorNode(field) {
      return field ? $('.al-field__error', field) : null;
    }

    function setError(control, message) {
      var field = fieldOf(control);
      control.setAttribute('aria-invalid', 'true');
      if (field) {
        field.classList.add('has-error');
        var err = errorNode(field);
        if (err && message) { err.textContent = message; }
      }
    }

    function clearError(control) {
      var field = fieldOf(control);
      control.removeAttribute('aria-invalid');
      if (field) {
        field.classList.remove('has-error');
        var err = errorNode(field);
        if (err) { err.textContent = ''; }
      }
    }

    function validateControl(control) {
      var value = (control.value || '').trim();
      var required = control.hasAttribute('required');
      var type = (control.getAttribute('type') || control.type || '').toLowerCase();

      // Checkboxes / radios: required means "must be checked".
      if (type === 'checkbox' || type === 'radio') {
        if (required && !control.checked) {
          setError(control, control.getAttribute('data-error') || 'This field is required.');
          return false;
        }
        clearError(control);
        return true;
      }

      if (required && !value) {
        setError(control, control.getAttribute('data-error') || 'This field is required.');
        return false;
      }
      if (value && (type === 'email' || control.hasAttribute('data-email'))) {
        if (!EMAIL_RE.test(value)) {
          setError(control, control.getAttribute('data-error-email') || 'Enter a valid email address.');
          return false;
        }
      }
      clearError(control);
      return true;
    }

    forms.forEach(function (form) {
      var controls = $$('input, textarea, select', form).filter(function (c) {
        return c.type !== 'hidden' && c.type !== 'submit' && c.type !== 'button';
      });

      // Clear a field's error state as the user corrects it.
      controls.forEach(function (control) {
        var evt = (control.tagName === 'SELECT' ||
                   control.type === 'checkbox' ||
                   control.type === 'radio') ? 'change' : 'input';
        control.addEventListener(evt, function () {
          if (fieldOf(control) && fieldOf(control).classList.contains('has-error')) {
            validateControl(control);
          }
        });
      });

      form.setAttribute('novalidate', 'novalidate'); // we handle validation
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var firstInvalid = null;
        var allValid = true;

        controls.forEach(function (control) {
          var ok = validateControl(control);
          if (!ok) {
            allValid = false;
            if (!firstInvalid) { firstInvalid = control; }
          }
        });

        if (!allValid) {
          if (firstInvalid && firstInvalid.focus) { firstInvalid.focus(); }
          return;
        }

        // Success path — static demo, no network request.
        var success = $('[data-form-success]', form.parentNode || document) ||
                      document.querySelector('[data-form-success]');
        form.hidden = true;
        form.style.display = 'none';
        if (success) {
          success.hidden = false;
          success.removeAttribute('hidden');
          // CSS hides [data-form-success] with display:none and reveals it via
          // .is-visible (display:flex); removing [hidden] alone isn't enough.
          success.classList.add('is-visible');
          if (success.setAttribute) { success.setAttribute('role', 'status'); }
          if (success.focus) {
            if (!success.hasAttribute('tabindex')) { success.setAttribute('tabindex', '-1'); }
            success.focus();
          }
        }
      });
    });
  }

  /* ------------------------------------------------------------------------
     6) WORK-INDEX CATEGORY FILTER
     Hooks: .al-filter__btn[data-filter="all|sales-cloud|service-cloud|
            experience-cloud|agentforce|integration|data-migration"]
            and .al-card--case[data-category~="…"] (space-separated tokens).
     Behaviour: MULTI-SELECT. Category buttons toggle independently and combine
     with OR logic (a card shows if it matches ANY active filter). "all" and the
     optional [data-filter-clear] button both reset the selection. The clear
     button is revealed only once 2+ filters are active. Buttons reflect state
     via .is-active + aria-pressed.
     ------------------------------------------------------------------------ */
  function initWorkFilter() {
    var buttons  = $$('.al-filter__btn[data-filter]');
    var cards    = $$('.al-card--case[data-category]');
    if (!buttons.length || !cards.length) { return; } // no-op if absent

    var allBtn      = buttons.filter(function (b) { return b.getAttribute('data-filter') === 'all'; })[0];
    var catButtons  = buttons.filter(function (b) { return b.getAttribute('data-filter') !== 'all'; });
    var clearBtn    = document.querySelector('[data-filter-clear]');

    // Set of currently-active category filters. Empty set === "All".
    var selected = [];

    function tokensOf(card) {
      return (card.getAttribute('data-category') || '').split(/\s+/).filter(Boolean);
    }

    function apply() {
      var showAll = selected.length === 0;

      cards.forEach(function (card) {
        var tokens = tokensOf(card);
        // OR logic: a card matches if it carries ANY selected category.
        var match = showAll || selected.some(function (f) { return tokens.indexOf(f) !== -1; });
        card.hidden = !match;
        // Belt-and-braces for CSS that may override [hidden].
        card.style.display = match ? '' : 'none';
      });

      catButtons.forEach(function (btn) {
        var on = selected.indexOf(btn.getAttribute('data-filter')) !== -1;
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });

      if (allBtn) {
        allBtn.classList.toggle('is-active', showAll);
        allBtn.setAttribute('aria-pressed', showAll ? 'true' : 'false');
      }

      // Clear button only surfaces once 2+ filters are active.
      if (clearBtn) { clearBtn.hidden = selected.length < 2; }
    }

    // Category buttons toggle in/out of the selection.
    catButtons.forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var f = btn.getAttribute('data-filter');
        var i = selected.indexOf(f);
        if (i === -1) { selected.push(f); } else { selected.splice(i, 1); }
        apply();
      });
    });

    // "All" and "Clear" both reset the selection.
    function reset(e) { if (e) { e.preventDefault(); } selected = []; apply(); }
    if (allBtn)   { allBtn.addEventListener('click', reset); }
    if (clearBtn) { clearBtn.addEventListener('click', reset); }

    apply(); // initial state: everything visible, "All" active
  }

  /* ------------------------------------------------------------------------
     7) STAR FIELD — animated particle-network background on every blue surface
     Hosts: .al-hero--immersive (home hero — keeps its own <canvas.al-hero__canvas>
            plus its gradient mesh + scrim, §9a) AND .al-section--navy and
            .al-cta-band, into which initStarFields() INJECTS a decorative
            <canvas.al-star-field> as the first child. Because this file is shared,
            every blue surface on every page lights up with ZERO HTML edits.
     Core: createStarField(host, canvas, opts) builds one field of drifting nodes
     with proximity links in brand hues, scoped to a single host, and returns a
     small handle. Decorative only — each canvas is aria-hidden, non-focusable and
     pointer-events:none (CSS), so it never disturbs focus order or clicks.
     Shared engine (single source of truth for all fields on the page):
       - ONE requestAnimationFrame loop ticks only the fields that are VISIBLE; it
         stops itself when none are visible, so off-screen surfaces cost nothing.
       - ONE visibilitychange handler pauses every field when the tab is hidden.
       - ONE debounced resize handler re-fits every field's backing store.
     Per-field guards (mirror the original hero): devicePixelRatio capped at 2;
     node count scales with area and is clamped (lower cap for short surfaces);
     its own IntersectionObserver pauses it off-screen; prefers-reduced-motion
     paints ONE static frame and never animates. No-ops where a host is absent.
     ------------------------------------------------------------------------ */

  // Shared engine state — every field registers here so a single rAF drives all
  // VISIBLE fields, and single resize / visibility handlers drive them all.
  var starFields = [];        // all fields on the page (for resize + visibility)
  var starActive = [];        // fields currently animating (on-screen + tab shown)
  var starRaf = null;         // shared rAF id, or null when idle
  var starTabVisible = true;
  var starResizeTimer = null;
  var starSharedBound = false;

  function starTick() {
    for (var i = 0; i < starActive.length; i++) { starActive[i]._frame(); }
    // Loop only while something is visible; otherwise go fully idle (no timers).
    starRaf = starActive.length ? window.requestAnimationFrame(starTick) : null;
  }

  function starActivate(field) {
    if (starActive.indexOf(field) === -1) {
      starActive.push(field);
      if (starRaf === null) { starRaf = window.requestAnimationFrame(starTick); }
    }
  }

  function starDeactivate(field) {
    var i = starActive.indexOf(field);
    if (i !== -1) { starActive.splice(i, 1); } // loop self-stops once empty
  }

  function starBindShared() {
    if (starSharedBound) { return; }
    starSharedBound = true;

    // Pause ALL fields when the tab is hidden; resume the visible ones on return.
    document.addEventListener('visibilitychange', function () {
      starTabVisible = !document.hidden;
      for (var i = 0; i < starFields.length; i++) { starFields[i]._sync(); }
    });

    // Debounced resize: re-fit every field's backing store + rebuild its nodes.
    window.addEventListener('resize', function () {
      if (starResizeTimer) { clearTimeout(starResizeTimer); }
      starResizeTimer = setTimeout(function () {
        for (var i = 0; i < starFields.length; i++) { starFields[i]._refit(); }
      }, 150);
    }, { passive: true });
  }

  // Factory: one self-contained star field bound to a single host + canvas.
  function createStarField(host, canvas, opts) {
    var ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) { return null; } // no 2D context -> the surface's navy bg remains

    opts = opts || {};
    var reduce  = prefersReducedMotion();
    var DPR     = Math.min(window.devicePixelRatio || 1, 2); // cap for GPU/memory
    var LINK    = 130;                    // px distance under which two nodes link
    var MIN     = opts.min     || 26;     // min node count (keeps short surfaces alive)
    var MAX     = opts.max     || 90;     // max node count (perf cap)
    var DENSITY = opts.density || 22000;  // px² per node before clamping

    // Brand hues (mirror the CSS hero tokens): light-blue, blue-60, purple, teal.
    var HUES = [
      [143, 208, 255],
      [1, 118, 211],
      [117, 38, 227],
      [3, 180, 167]
    ];
    var LINE_RGB = '120, 170, 230';

    // Optional per-host accent (opts.accent): biases ~half the nodes toward one
    // brand hue so a page's particle field echoes its CSS mesh reweight, while the
    // rest stay multi-hue to keep the shared identity. Unknown/empty -> no bias.
    var ACCENT_HUES = {
      blue:   [1, 118, 211],
      teal:   [3, 180, 167],
      purple: [117, 38, 227],
      mono:   [143, 208, 255]
    };
    var accentHue = ACCENT_HUES[opts.accent] || null;

    var w = 0, h = 0, nodes = [], onScreen = true;

    function size() {
      var rect = host.getBoundingClientRect();
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(w * DPR);
      canvas.height = Math.round(h * DPR);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0); // draw in CSS px
    }

    function build() {
      // ~1 node / DENSITY px², clamped so density feels even on any surface size.
      var count = Math.round(Math.min(MAX, Math.max(MIN, (w * h) / DENSITY)));
      nodes = [];
      for (var i = 0; i < count; i++) {
        var hue = (accentHue && Math.random() < 0.5)
          ? accentHue
          : HUES[(Math.random() * HUES.length) | 0];
        nodes.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.24,
          vy: (Math.random() - 0.5) * 0.24,
          r: Math.random() * 5 + 3,
          hue: hue
        });
      }
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);

      // Proximity links (drawn first, under the nodes).
      for (var i = 0; i < nodes.length; i++) {
        var a = nodes[i];
        for (var j = i + 1; j < nodes.length; j++) {
          var b = nodes[j];
          var dx = a.x - b.x, dy = a.y - b.y;
          var d2 = dx * dx + dy * dy;
          if (d2 < LINK * LINK) {
            var alpha = (1 - Math.sqrt(d2) / LINK) * 0.16; // keep subtle for AA
            ctx.strokeStyle = 'rgba(' + LINE_RGB + ',' + alpha.toFixed(3) + ')';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      // Nodes.
      for (var k = 0; k < nodes.length; k++) {
        var n = nodes[k];
        ctx.fillStyle = 'rgba(' + n.hue[0] + ',' + n.hue[1] + ',' + n.hue[2] + ',0.65)';
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // One animation step: advance the nodes, then repaint. Called by the shared
    // loop; not a self-scheduling rAF (the engine owns the single loop).
    function frame() {
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        n.x += n.vx;
        n.y += n.vy;
        // Wrap around the edges for a seamless, endless field.
        if (n.x < -20) { n.x = w + 20; } else if (n.x > w + 20) { n.x = -20; }
        if (n.y < -20) { n.y = h + 20; } else if (n.y > h + 20) { n.y = -20; }
      }
      draw();
    }

    var field = {
      _frame: frame,
      // Re-fit after a resize; repaint a static frame while paused so an idle or
      // reduced-motion field stays correct even when it isn't in the loop.
      _refit: function () {
        size();
        build();
        if (starActive.indexOf(field) === -1) { draw(); }
      },
      // Join/leave the shared loop based on this field's own visibility + tab state.
      _sync: function () {
        if (reduce) { return; }
        if (onScreen && starTabVisible) { starActivate(field); }
        else { starDeactivate(field); }
      }
    };

    // Initial layout + field, then one paint (also the reduced-motion frame and a
    // correct static frame for surfaces that start off-screen).
    size();
    build();
    draw();

    // Register for shared resize/visibility. Reduced-motion fields still re-fit on
    // resize (via _refit) but _sync no-ops, so they never join the animation loop.
    starFields.push(field);
    starBindShared();
    if (reduce) { return field; }

    // Pause this field while it is scrolled off-screen.
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        onScreen = entries[0].isIntersecting;
        field._sync();
      }, { threshold: 0 });
      io.observe(host);
    }

    field._sync(); // start now if already on-screen
    return field;
  }

  /* Wire a star field onto every blue surface. The home hero reuses its existing
     dedicated <canvas.al-hero__canvas> (keeping its mesh + scrim + z-order intact);
     every other blue surface gets a <canvas.al-star-field> injected as its first
     child. Idempotent and safe on any page — no-ops where the hosts are absent. */
  function initStarFields() {
    // Pages can opt out of the animated particle field via <body data-no-star-field>
    // (e.g. case-study detail pages): the blue surfaces then keep their static CSS
    // gradient backgrounds — the immersive hero's drifting mesh (§9a) and the CTA
    // band's bloom gradient (§9b) — with no canvas injected or animated.
    if (document.body && document.body.hasAttribute('data-no-star-field')) { return; }

    // Footer uses a static CSS gradient (not particles) so it stays consistent
    // across every page — including when it is injected via data-al-include.
    var hosts = $$('.al-hero--immersive, .al-section--navy, .al-cta-band');
    var seen = [];
    hosts.forEach(function (host) {
      if (seen.indexOf(host) !== -1) { return; } // one field per host
      seen.push(host);

      // Immersive hero (home + per-page banners): animate its existing canvas with
      // the original density/look. An optional data-hero-accent biases the particle
      // hues toward this page's accent (home has none -> full multi-hue).
      if (host.classList.contains('al-hero--immersive')) {
        var heroCanvas = $('[data-hero-canvas]', host);
        if (heroCanvas) { createStarField(host, heroCanvas, { accent: host.getAttribute('data-hero-accent') || '' }); }
        return;
      }

      // Every other blue surface: inject a decorative canvas behind the content.
      if ($('.al-star-field', host)) { return; } // already wired (idempotent)
      var canvas = document.createElement('canvas');
      canvas.className = 'al-star-field';
      canvas.setAttribute('aria-hidden', 'true');
      host.insertBefore(canvas, host.firstChild);
      // Sparser + capped lower than the hero: these surfaces are shorter and sit
      // directly under body copy (CSS token --al-star-field-opacity also dims them).
      createStarField(host, canvas, { min: 14, max: 54, density: 26000 });
    });
  }

  /* ------------------------------------------------------------------------
     7b) SERVICES PILLAR RAIL — scroll-spy for the sticky capability navigator.
     Hooks: .al-sv-rail__link[href="#id"] anchors + the matching pillar
     sections (id). Highlights the link whose pillar is nearest the viewport
     centre via IntersectionObserver, mirroring state with .is-active +
     aria-current. Progressive enhancement: the anchors already navigate with
     no JS; this only adds the active highlight. No-ops if absent or if IO is
     unsupported (the first link keeps its initial is-active state).
     ------------------------------------------------------------------------ */
  function initServicesNav() {
    var links = $$('.al-sv-rail__link');
    if (!links.length || !('IntersectionObserver' in window)) { return; }

    var map = {};
    var sections = [];
    links.forEach(function (link) {
      var id = (link.getAttribute('href') || '').replace(/^#/, '');
      var sec = id && document.getElementById(id);
      if (sec) { map[id] = link; sections.push(sec); }
    });
    if (!sections.length) { return; }

    function setActive(id) {
      links.forEach(function (link) {
        var on = link === map[id];
        link.classList.toggle('is-active', on);
        if (on) { link.setAttribute('aria-current', 'true'); }
        else { link.removeAttribute('aria-current'); }
      });
    }

    // A band across the viewport middle: the pillar crossing it wins.
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { setActive(entry.target.id); }
      });
    }, { root: null, rootMargin: '-45% 0px -45% 0px', threshold: 0 });

    sections.forEach(function (sec) { io.observe(sec); });
  }

  /* ------------------------------------------------------------------------
     8) HELP CHAT — floating “Need help?” widget, bottom-right.
     Injected once into <body> on every page (no HTML edits required). Opens a
     small chat-style panel with Contact us CTAs. Escape / outside click close.
     ------------------------------------------------------------------------ */
  function initHelpChat() {
    if ($('[data-al-help]')) { return; } // idempotent

    var root = document.createElement('div');
    root.className = 'al-help';
    root.setAttribute('data-al-help', '');
    root.innerHTML =
      '<div class="al-help__panel" id="al-help-panel" role="dialog" aria-modal="false" aria-labelledby="al-help-title" hidden>' +
        '<div class="al-help__header">' +
          '<div class="al-help__header-text">' +
            '<h2 class="al-help__title" id="al-help-title">Contact us</h2>' +
            '<span class="al-help__status">Usually replies within 1 business day</span>' +
          '</div>' +
          '<button class="al-help__close" type="button" data-al-help-close aria-label="Close help">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
              '<path d="M6 6l12 12M18 6L6 18"/>' +
            '</svg>' +
          '</button>' +
        '</div>' +
        '<div class="al-help__body">' +
          '<p class="al-help__bubble">Hi — looking for Salesforce solutions tailored to your business? Let\'s talk.</p>' +
          '<div class="al-help__actions">' +
            '<a class="al-btn al-btn--primary" href="/contact">Contact us</a>' +
            '<a class="al-btn al-btn--secondary" href="/contact">Get a scoped estimate</a>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<button class="al-help__launcher" type="button" data-al-help-toggle aria-expanded="false" aria-controls="al-help-panel">' +
        '<span class="al-help__launcher-icon" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M21 12a8.5 8.5 0 01-8.5 8.5c-1.2 0-2.3-.25-3.3-.7L3 21l1.3-5.7A8.4 8.4 0 013.5 12 8.5 8.5 0 0112 3.5h.5A8.5 8.5 0 0121 12z"/>' +
          '</svg>' +
        '</span>' +
        '<span class="al-help__launcher-label al-help__launcher-label--open">Contact us</span>' +
        '<span class="al-help__launcher-label al-help__launcher-label--close">Close</span>' +
      '</button>';

    document.body.appendChild(root);

    var panel = $('#al-help-panel', root);
    var toggle = $('[data-al-help-toggle]', root);
    var closeBtn = $('[data-al-help-close]', root);

    function isOpen() { return root.classList.contains('is-open'); }

    function openPanel() {
      root.classList.add('is-open');
      panel.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      // Defer focus so the panel is visible before moving keyboard focus.
      window.setTimeout(function () {
        if (closeBtn) { closeBtn.focus(); }
      }, 0);
    }

    function closePanel() {
      root.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      // Keep in DOM for exit animation; mark hidden after transition.
      window.setTimeout(function () {
        if (!isOpen()) { panel.hidden = true; }
      }, prefersReducedMotion() ? 0 : 200);
      toggle.focus();
    }

    function togglePanel() { isOpen() ? closePanel() : openPanel(); }

    toggle.addEventListener('click', togglePanel);
    closeBtn.addEventListener('click', closePanel);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) {
        e.preventDefault();
        closePanel();
      }
    });

    document.addEventListener('click', function (e) {
      if (!isOpen()) { return; }
      if (!root.contains(e.target)) { closePanel(); }
    });
  }

  /* ------------------------------------------------------------------------
     9) HTML PARTIALS (navbar, footer, …)
     Hook: <div data-al-include="navbar|footer"></div>
     Navbar options on the mount:
       data-al-nav-on-hero  — add .al-navbar--on-hero (dark bar over hero)
     Active link is inferred from location.pathname after inject.
     Absolute asset/link paths in partials work from any page depth.
     Returns a Promise so boot can wire nav behaviours after mounts resolve.
     ------------------------------------------------------------------------ */
  var includeCache = {};

  function fetchPartial(name) {
    if (!includeCache[name]) {
      includeCache[name] = fetch('/partials/' + encodeURIComponent(name) + '.html')
        .then(function (res) {
          if (!res.ok) { throw new Error('partial ' + name + ' → ' + res.status); }
          return res.text();
        })
        .catch(function (err) {
          includeCache[name] = null; // allow retry on later mounts
          if (typeof console !== 'undefined' && console.warn) {
            console.warn('[al] include failed:', name, err);
          }
          return null;
        });
    }
    return includeCache[name];
  }

  function navActiveHref(pathname) {
    var path = (pathname || '/').split('?')[0].split('#')[0];
    if (path.length > 1 && path.charAt(path.length - 1) === '/') {
      path = path.slice(0, -1);
    }
    if (/\.html$/i.test(path)) {
      path = path.replace(/\.html$/i, '');
    }
    if (path === '' || path === '/' || path === '/index') { return '/'; }
    if (path === '/services' || path.indexOf('/services/') === 0) { return '/services'; }
    if (path === '/case-studies' || path.indexOf('/case-studies/') === 0 ||
        path === '/work' || path.indexOf('/work/') === 0) {
      return '/case-studies';
    }
    if (path === '/approach') { return '/approach'; }
    if (path === '/contact') { return '/contact'; }
    if (path === '/insights' || path.indexOf('/insights/') === 0) { return '/insights'; }
    return null; // legal / 404 / etc. — no active item
  }

  function enhanceNavbar(header, onHero) {
    if (!header || !header.classList) { return; }
    if (onHero) { header.classList.add('al-navbar--on-hero'); }

    var href = navActiveHref(window.location.pathname);
    if (!href) { return; }

    $$('.al-navbar__link', header).forEach(function (link) {
      if (link.getAttribute('href') === href) {
        link.classList.add('is-active');
        link.setAttribute('aria-current', 'page');
      }
    });
  }

  function initIncludes() {
    var mounts = $$('[data-al-include]');
    if (!mounts.length) { return Promise.resolve(); }

    return Promise.all(mounts.map(function (el) {
      var name = (el.getAttribute('data-al-include') || '').trim();
      if (!name) { return Promise.resolve(); }

      var onHero = el.hasAttribute('data-al-nav-on-hero');

      return fetchPartial(name).then(function (html) {
        if (!html || !el.parentNode) { return; }
        var wrap = document.createElement('div');
        wrap.innerHTML = html.trim();
        var nodes = Array.prototype.slice.call(wrap.childNodes);
        var insertedHeader = null;
        nodes.forEach(function (node) {
          if (node.nodeType === 1 && node.classList && node.classList.contains('al-navbar')) {
            insertedHeader = node;
          }
          el.parentNode.insertBefore(node, el);
        });
        el.parentNode.removeChild(el);

        if (name === 'navbar' && insertedHeader) {
          enhanceNavbar(insertedHeader, onHero);
        }
      });
    }));
  }

  /* ------------------------------------------------------------------------
     Boot — run every initialiser. Includes resolve first so navbar/footer
     hooks exist before mobile-nav / sticky-nav (and friends) bind to them.
     ------------------------------------------------------------------------ */
  function init() {
    initIncludes().then(function () {
      initMobileNav();
      initStickyNav();
      initAccordion();
      initScrollReveal();
      initForms();
      initWorkFilter();
      initServicesNav();
      initStarFields();
      initHelpChat();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init(); // defer normally guarantees DOM is ready, but be robust anyway
  }
})();
