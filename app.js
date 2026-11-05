/* LiNav: License Finder
   Loads the questions and licenses from two JSON files, then:
   - asks "Are you licensing software?" first; the answer picks one license family
     (open source or Creative Commons) and shows only that family's questions and cards
   - hides cards that don't match every answer
   - lets people select cards and compare them in a table.
   A license matches when every answer you chose appears in that license's "options" list. */

(function () {
  "use strict";

  var QUESTIONS_URL = "questions.json";
  var CATALOG_URL = "catalog.json";

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    finder: $("finder"), loadError: $("load-error"), questionList: $("question-list"),
    groups: $("card-groups"), status: $("status"), empty: $("empty"),
    clearAnswers: $("clear-answers"), selectAll: $("select-all"), clearSelections: $("clear-selections"),
    compareBar: $("compare-bar"), compareCount: $("compare-count"),
    comparison: $("comparison"), tableMount: $("table-mount")
  };

  var sections = [];
  var families = {};
  var licenses = [];

  var familyKey = null;        // "cc", "os", or null until the first question is answered
  var answers = new Set();     // option ids checked in the family questions
  var selected = new Set();    // license ids picked to compare

  var optionInputs = {};       // option id -> input
  var sectionItems = {};       // section id -> <li>
  var clearButtons = {};       // section id -> "Clear this answer" button
  var groupEls = {};           // family -> { box, grid }
  var cards = {};              // license id -> card button

  start();

  function start() {
    Promise.all([getJSON(QUESTIONS_URL), getJSON(CATALOG_URL)])
      .then(function (results) {
        sections = results[0].sections;
        families = results[1].families;
        licenses = results[1].licenses;
        sections.forEach(renderSection);
        Object.keys(families).forEach(renderGroup);
        licenses.forEach(renderCard);
        bindEvents();
        refresh();
      })
      .catch(showLoadError);
  }

  function getJSON(url) {
    return fetch(url).then(function (response) {
      if (!response.ok) { throw new Error("Could not load " + url + " (" + response.status + ")"); }
      return response.json();
    });
  }

  function showLoadError(error) {
    el.finder.hidden = true;
    el.loadError.hidden = false;
    el.loadError.textContent =
      "The questions and licenses could not be loaded. " + error.message + ". " +
      "This page reads its data from JSON files, so it must be opened through a web server " +
      "(such as GitHub Pages), not by double-clicking the file.";
  }

  /* ---------- Questions ---------- */

  function isGate(section) { return section.role === "family"; }

  function renderSection(section) {
    var item = document.createElement("li");
    item.className = "question";
    sectionItems[section.id] = item;

    var group = document.createElement("div");
    group.setAttribute("role", section.exclusive ? "radiogroup" : "group");
    group.setAttribute("aria-labelledby", "q-" + section.id + "-title");

    var head = document.createElement("div");
    head.className = "question-head";

    var title = document.createElement("p");
    title.className = "question-title";
    title.id = "q-" + section.id + "-title";
    title.textContent = section.question;

    var info = document.createElement("button");
    info.type = "button";
    info.className = "info-btn";
    info.textContent = "i";
    info.setAttribute("aria-expanded", "false");
    info.setAttribute("aria-controls", "tip-" + section.id);
    info.setAttribute("aria-label", "More information: " + section.question);

    head.appendChild(title);
    head.appendChild(info);
    group.appendChild(head);

    var tip = document.createElement("div");
    tip.className = "tip";
    tip.id = "tip-" + section.id;
    tip.hidden = true;
    tip.innerHTML = section.helper_info;   // trusted: comes from this site's own JSON file
    group.appendChild(tip);

    section.options.forEach(function (option) {
      var row = document.createElement("div");
      row.className = "option";

      // Pick-one questions use radio buttons. Questions with a single yes option use a checkbox.
      var input = document.createElement("input");
      input.type = section.exclusive ? "radio" : "checkbox";
      if (section.exclusive) { input.name = "q-" + section.id; }
      input.id = "opt-" + option.id;
      input.value = option.id;
      optionInputs[option.id] = input;

      var label = document.createElement("label");
      label.setAttribute("for", input.id);
      label.textContent = option.label;

      input.addEventListener("change", function () { onAnswer(section, option, input); });

      row.appendChild(input);
      row.appendChild(label);
      group.appendChild(row);
    });

    // Radio buttons cannot be switched off, so pick-one questions get a small clear button.
    if (section.exclusive) {
      var clear = document.createElement("button");
      clear.type = "button";
      clear.className = "link-btn";
      clear.textContent = "Clear this answer";
      clear.hidden = true;
      clear.addEventListener("click", function () { onClear(section); });
      clearButtons[section.id] = clear;
      group.appendChild(clear);
    }

    item.appendChild(group);
    el.questionList.appendChild(item);
  }

  function onAnswer(section, option, input) {
    if (isGate(section)) {
      setFamily(option.family);
      return;
    }
    if (section.exclusive) {
      section.options.forEach(function (o) { answers["delete"](o.id); });
      answers.add(option.id);
    } else if (input.checked) {
      answers.add(option.id);
    } else {
      answers["delete"](option.id);
    }
    refresh();
  }

  function onClear(section) {
    clearSection(section);
    if (isGate(section)) { setFamily(null); } else { refresh(); }
  }

  function clearSection(section) {
    section.options.forEach(function (option) {
      answers["delete"](option.id);
      optionInputs[option.id].checked = false;
    });
  }

  // Choosing a family hides the other family's cards and questions for good.
  function setFamily(key) {
    familyKey = key;
    el.finder.setAttribute("data-family", key || "");
    licenses.forEach(function (license) {
      if (key && license.family !== key) { selected["delete"](license.id); }
    });
    refresh();
  }

  function sectionVisible(section) {
    if (isGate(section)) { return true; }
    if (!familyKey || section.family !== familyKey) { return false; }
    if (section.showWhen && !answers.has(section.showWhen)) { return false; }
    return true;
  }

  // Show or hide questions. A hidden question loses its answers, which may hide others, so repeat until stable.
  function applyVisibility() {
    var changed = true;
    var guard = 0;
    while (changed && guard < 10) {
      changed = false;
      guard += 1;
      sections.forEach(function (section) {
        var visible = sectionVisible(section);
        var item = sectionItems[section.id];
        if (item.hidden === visible) {
          item.hidden = !visible;
          changed = true;
        }
        if (!visible && !isGate(section)) { clearSection(section); }
      });
    }
    sections.forEach(function (section) {
      var button = clearButtons[section.id];
      if (!button) { return; }
      button.hidden = !section.options.some(function (o) { return optionInputs[o.id].checked; });
    });
  }

  /* ---------- Cards ---------- */

  function renderGroup(key) {
    var family = families[key];

    var box = document.createElement("section");
    box.className = "card-group";
    box.setAttribute("data-family", key);
    box.setAttribute("aria-labelledby", "group-" + key + "-title");

    var head = document.createElement("div");
    head.className = "group-head";
    var title = document.createElement("h3");
    title.className = "group-title";
    title.id = "group-" + key + "-title";
    title.textContent = family.groupTitle;
    var note = document.createElement("p");
    note.className = "group-note";
    note.textContent = family.groupNote;
    head.appendChild(title);
    head.appendChild(note);

    var grid = document.createElement("div");
    grid.className = "card-grid";

    box.appendChild(head);
    box.appendChild(grid);
    el.groups.appendChild(box);
    groupEls[key] = { box: box, grid: grid };
  }

  function renderCard(license) {
    var card = document.createElement("button");
    card.type = "button";
    card.className = "license-card";
    card.setAttribute("aria-pressed", "false");

    // The badge names the family in words, so color is never the only cue.
    var badge = document.createElement("span");
    badge.className = "card-badge";
    badge.textContent = families[license.family].badge;

    var title = document.createElement("span");
    title.className = "card-title";
    title.textContent = license.Title;

    var intro = document.createElement("span");
    intro.className = "card-intro";
    intro.textContent = license.Intro;

    var state = document.createElement("span");
    state.className = "card-state";
    state.setAttribute("aria-hidden", "true");

    card.appendChild(badge);
    card.appendChild(title);
    card.appendChild(intro);
    card.appendChild(state);

    card.addEventListener("click", function () {
      if (selected.has(license.id)) { selected["delete"](license.id); } else { selected.add(license.id); }
      update();
    });

    cards[license.id] = card;
    groupEls[license.family].grid.appendChild(card);
  }

  function matches(license) {
    if (familyKey && license.family !== familyKey) { return false; }
    return Array.from(answers).every(function (id) { return license.options.indexOf(id) !== -1; });
  }

  /* ---------- Refresh everything that depends on answers or selections ---------- */

  function refresh() {
    applyVisibility();
    update();
  }

  function update() {
    var matchCount = 0;
    var invalidTitles = [];
    var lastMatch = null;
    var shownByFamily = {};
    var shown = 0;

    licenses.forEach(function (license) {
      var card = cards[license.id];
      var ok = matches(license);
      var picked = selected.has(license.id);

      if (ok) { matchCount += 1; lastMatch = license; }
      if (picked && !ok) { invalidTitles.push(license.Title); }

      // Cards that don't match disappear, unless the person already picked them.
      card.hidden = !ok && !picked;
      if (!card.hidden) {
        shown += 1;
        shownByFamily[license.family] = (shownByFamily[license.family] || 0) + 1;
      }

      card.classList.toggle("is-selected", picked && ok);
      card.classList.toggle("is-invalid", picked && !ok);
      card.setAttribute("aria-pressed", picked ? "true" : "false");
      card.lastChild.textContent = picked
        ? (ok ? "\u2713 Selected" : "Selected, but no longer matches")
        : "";
    });

    Object.keys(groupEls).forEach(function (key) {
      groupEls[key].box.hidden = !shownByFamily[key];
    });

    el.empty.hidden = shown > 0;
    el.status.textContent = statusText(matchCount, lastMatch, invalidTitles);
    renderCompare();
  }

  function statusText(matchCount, lastMatch, invalidTitles) {
    var text;
    var pool = licenses.filter(function (l) { return !familyKey || l.family === familyKey; });

    if (!familyKey) {
      var parts = Object.keys(families).map(function (key) {
        var n = licenses.filter(function (l) { return l.family === key; }).length;
        return n + " " + families[key].name;
      });
      text = "Showing all " + licenses.length + " licenses: " + parts.join(" and ") +
        ". Answer the first question to narrow the list.";
    } else if (answers.size === 0) {
      text = "Showing all " + pool.length + " " + families[familyKey].name +
        " licenses. Answer the questions to narrow the list.";
    } else if (matchCount === 0) {
      text = "No license matches all of your answers.";
    } else if (matchCount === 1) {
      text = "1 license matches your answers: " + lastMatch.Title + ".";
    } else {
      text = matchCount + " of " + pool.length + " " + families[familyKey].name + " licenses match your answers.";
    }
    if (invalidTitles.length) {
      text += " Selected but no longer matching: " + invalidTitles.join(", ") + ".";
    }
    return text;
  }

  /* ---------- Compare bar and tables (one table per license family) ---------- */

  function renderCompare() {
    var chosen = licenses.filter(function (license) { return selected.has(license.id); });
    var any = chosen.length > 0;

    el.compareBar.hidden = !any;
    el.comparison.hidden = !any;
    el.tableMount.textContent = "";
    if (!any) { return; }

    el.compareCount.textContent = chosen.length + (chosen.length === 1 ? " license selected" : " licenses selected");

    Object.keys(families).forEach(function (key) {
      var group = chosen.filter(function (license) { return license.family === key; });
      if (group.length) { el.tableMount.appendChild(buildTable(key, group)); }
    });
  }

  function buildTable(key, group) {
    var family = families[key];

    var block = document.createElement("div");
    block.className = "compare-block";
    block.setAttribute("data-family", key);

    var heading = document.createElement("h3");
    heading.className = "compare-heading";
    heading.id = "compare-" + key + "-title";
    heading.textContent = family.groupTitle;
    block.appendChild(heading);

    var wrap = document.createElement("div");
    wrap.className = "table-wrap";

    var table = document.createElement("table");
    table.className = "compare-table";
    table.setAttribute("aria-labelledby", heading.id);

    var headRow = table.createTHead().insertRow();
    var corner = document.createElement("th");
    corner.scope = "col";
    corner.innerHTML = '<span class="visually-hidden">Feature</span>';
    headRow.appendChild(corner);

    group.forEach(function (license) {
      var th = document.createElement("th");
      th.scope = "col";
      th.textContent = license.Title;
      if (!matches(license)) {
        var note = document.createElement("span");
        note.className = "th-note";
        note.textContent = "Does not match your answers";
        th.appendChild(note);
      }
      headRow.appendChild(th);
    });

    var tbody = table.createTBody();
    family.tableFields.forEach(function (field) {
      var row = tbody.insertRow();
      var th = document.createElement("th");
      th.scope = "row";
      th.textContent = field;
      row.appendChild(th);
      group.forEach(function (license) { fillCell(row.insertCell(), license[field]); });
    });

    wrap.appendChild(table);
    block.appendChild(wrap);
    return block;
  }

  // Values are plain text, a list of text lines, or small HTML snippets (links) from our own JSON.
  function fillCell(td, value) {
    if (Array.isArray(value)) {
      var list = document.createElement("ul");
      value.forEach(function (line) {
        var li = document.createElement("li");
        li.textContent = line;
        list.appendChild(li);
      });
      td.appendChild(list);
    } else {
      td.innerHTML = value;
    }
  }

  /* ---------- Buttons and info icons ---------- */

  function bindEvents() {
    el.clearAnswers.addEventListener("click", function () {
      sections.forEach(clearSection);
      setFamily(null);
    });

    el.selectAll.addEventListener("click", function () {
      licenses.forEach(function (license) { if (matches(license)) { selected.add(license.id); } });
      update();
    });

    el.clearSelections.addEventListener("click", function () {
      selected.clear();
      update();
    });

    el.questionList.addEventListener("click", function (event) {
      var button = event.target.closest(".info-btn");
      if (!button) { return; }
      var panel = $(button.getAttribute("aria-controls"));
      var open = button.getAttribute("aria-expanded") === "true";
      button.setAttribute("aria-expanded", open ? "false" : "true");
      panel.hidden = open;
    });
  }
})();
