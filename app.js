/* LiNav: Creative Commons License Finder
   Loads the questions and licenses from JSON, then:
   - shows a checkbox question list on the left
   - shows one card per license on the right, hiding cards that don't match every answer
   - lets people select cards and compare them in a table.
   A license matches when every answer you chose appears in that license's "options" list. */

(function () {
  "use strict";

  var QUESTIONS_URL = "cc-questions.json";
  var LICENSES_URL = "cc-licenses.json";

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    finder: $("finder"), loadError: $("load-error"), questionList: $("question-list"),
    grid: $("card-grid"), status: $("status"), empty: $("empty"),
    clearAnswers: $("clear-answers"), selectAll: $("select-all"), clearSelections: $("clear-selections"),
    compareBar: $("compare-bar"), compareCount: $("compare-count"),
    comparison: $("comparison"), tableMount: $("table-mount")
  };

  var sections = [];
  var licenses = [];
  var tableFields = [];

  var answers = new Set();     // option ids the person has checked
  var selected = new Set();    // license ids the person has picked to compare

  var optionInputs = {};       // option id -> checkbox
  var sectionItems = {};       // section id -> <li>
  var cards = {};              // license id -> card button

  start();

  function start() {
    Promise.all([getJSON(QUESTIONS_URL), getJSON(LICENSES_URL)])
      .then(function (results) {
        sections = results[0].sections;
        licenses = results[1].licenses;
        tableFields = results[1].tableFields;
        sections.forEach(renderSection);
        licenses.forEach(renderCard);
        bindEvents();
        update();
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

  function renderSection(section) {
    var item = document.createElement("li");
    item.className = "question";
    if (section.showWhen) { item.hidden = true; }
    sectionItems[section.id] = item;

    var group = document.createElement("div");
    group.setAttribute("role", "group");
    group.setAttribute("aria-labelledby", "q" + section.id + "-title");

    var head = document.createElement("div");
    head.className = "question-head";

    var title = document.createElement("p");
    title.className = "question-title";
    title.id = "q" + section.id + "-title";
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

      var input = document.createElement("input");
      input.type = "checkbox";
      input.id = "opt-" + option.id;
      input.value = option.id;
      optionInputs[option.id] = input;

      var label = document.createElement("label");
      label.setAttribute("for", input.id);
      label.textContent = option.label;

      input.addEventListener("change", function () { onAnswer(section, input); });

      row.appendChild(input);
      row.appendChild(label);
      group.appendChild(row);
    });

    item.appendChild(group);
    el.questionList.appendChild(item);
  }

  function setAnswer(optionId, on) {
    optionInputs[optionId].checked = on;
    if (on) { answers.add(optionId); } else { answers["delete"](optionId); }
  }

  function onAnswer(section, input) {
    if (input.checked && section.exclusive) {
      section.options.forEach(function (option) {
        if (option.id !== input.value) { setAnswer(option.id, false); }
      });
    }
    setAnswer(input.value, input.checked);
    applyDependencies();
    update();
  }

  // A question with "showWhen" only appears while that answer is checked.
  function applyDependencies() {
    sections.forEach(function (section) {
      if (!section.showWhen) { return; }
      var visible = answers.has(section.showWhen);
      sectionItems[section.id].hidden = !visible;
      if (!visible) {
        section.options.forEach(function (option) { setAnswer(option.id, false); });
      }
    });
  }

  /* ---------- Cards ---------- */

  function renderCard(license) {
    var card = document.createElement("button");
    card.type = "button";
    card.className = "license-card";
    card.setAttribute("aria-pressed", "false");

    var title = document.createElement("span");
    title.className = "card-title";
    title.textContent = license.Title;

    var intro = document.createElement("span");
    intro.className = "card-intro";
    intro.textContent = license.Intro;

    var state = document.createElement("span");
    state.className = "card-state";
    state.setAttribute("aria-hidden", "true");

    card.appendChild(title);
    card.appendChild(intro);
    card.appendChild(state);

    card.addEventListener("click", function () {
      if (selected.has(license.id)) { selected["delete"](license.id); } else { selected.add(license.id); }
      update();
    });

    cards[license.id] = card;
    el.grid.appendChild(card);
  }

  function matches(license) {
    var chosen = Array.from(answers);
    return chosen.every(function (id) { return license.options.indexOf(id) !== -1; });
  }

  /* ---------- Refresh everything that depends on answers or selections ---------- */

  function update() {
    var matchCount = 0;
    var invalidTitles = [];
    var lastMatch = null;
    var shown = 0;

    licenses.forEach(function (license) {
      var card = cards[license.id];
      var ok = matches(license);
      var picked = selected.has(license.id);

      if (ok) { matchCount += 1; lastMatch = license; }
      if (picked && !ok) { invalidTitles.push(license.Title); }

      // Cards that don't match disappear, unless the person already picked them.
      card.hidden = !ok && !picked;
      if (!card.hidden) { shown += 1; }

      card.classList.toggle("is-selected", picked && ok);
      card.classList.toggle("is-invalid", picked && !ok);
      card.setAttribute("aria-pressed", picked ? "true" : "false");
      card.lastChild.textContent = picked
        ? (ok ? "\u2713 Selected" : "Selected, but no longer matches")
        : "";
    });

    el.empty.hidden = shown > 0;
    el.status.textContent = statusText(matchCount, lastMatch, invalidTitles);
    renderCompare();
  }

  function statusText(matchCount, lastMatch, invalidTitles) {
    var text;
    if (answers.size === 0) {
      text = "Showing all " + licenses.length + " licenses. Answer the questions to narrow the list.";
    } else if (matchCount === 0) {
      text = "No license matches all of your answers.";
    } else if (matchCount === 1) {
      text = "1 license matches your answers: " + lastMatch.Title + ".";
    } else {
      text = matchCount + " of " + licenses.length + " licenses match your answers.";
    }
    if (invalidTitles.length) {
      text += " Selected but no longer matching: " + invalidTitles.join(", ") + ".";
    }
    return text;
  }

  /* ---------- Compare bar and table ---------- */

  function renderCompare() {
    var chosen = licenses.filter(function (license) { return selected.has(license.id); });
    var any = chosen.length > 0;

    el.compareBar.hidden = !any;
    el.comparison.hidden = !any;
    el.tableMount.textContent = "";
    if (!any) { return; }

    el.compareCount.textContent = chosen.length + (chosen.length === 1 ? " license selected" : " licenses selected");

    var table = document.createElement("table");
    table.className = "compare-table";

    var thead = table.createTHead();
    var headRow = thead.insertRow();
    var corner = document.createElement("th");
    corner.scope = "col";
    corner.innerHTML = '<span class="visually-hidden">Feature</span>';
    headRow.appendChild(corner);

    chosen.forEach(function (license) {
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
    tableFields.forEach(function (field) {
      var row = tbody.insertRow();
      var th = document.createElement("th");
      th.scope = "row";
      th.textContent = field;
      row.appendChild(th);

      chosen.forEach(function (license) {
        var td = row.insertCell();
        fillCell(td, license[field]);
      });
    });

    el.tableMount.appendChild(table);
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
      answers.clear();
      Object.keys(optionInputs).forEach(function (id) { optionInputs[id].checked = false; });
      applyDependencies();
      update();
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
