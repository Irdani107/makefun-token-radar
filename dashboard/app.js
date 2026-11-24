// Token Launch Radar — board rendering, filtering, sorting, detail view.
(function () {
  var D = window.RADAR;
  var rows = D.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  function money(v) {
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K';
    return '$' + v;
  }
  function pct(x) {
    if (x === null || x === undefined) return '<td class="num">-</td>';
    var cls = x >= 0 ? 'pos' : 'neg';
    return '<td class="num ' + cls + '">' + (x >= 0 ? '+' : '') + x.toFixed(1) + '%</td>';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  }

  var meta = document.getElementById('meta');
  meta.textContent = 'Snapshot ' + D.as_of + ' · ' + rows.length +
    ' protocols ranked · watchlist floor ' + money(D.floor_usd) + ' TVL · ' +
    rows.filter(function (r) { return r.watchlist; }).length + ' watchlist protocols covered';

  var m = D.model;
  document.getElementById('model').innerHTML =
    '<b>The fitted model.</b> Fitted at build time on the ' + m.launched_sample +
    ' snapshot protocols that already record a token. Value equation: <span class="eq">implied = TVL x category multiple x momentum x age factor</span>' +
    ' · global median multiple <b>' + m.global_median_multiple + 'x</b>' +
    ' · momentum slope &beta; = <b>' + m.momentum_beta + '</b>' +
    ' · age slope &gamma; = <b>' + m.age_gamma + '</b>' +
    ' · category medians shrunk toward the global median (k = ' + m.shrinkage + ')' +
    ' · peer ratios winsorised to [0.01x, 10x] so one microcap cannot price a whole category.';

  var catSel = document.getElementById('cat');
  var cats = [];
  rows.forEach(function (r) { if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category); });
  cats.sort();
  catSel.innerHTML = '<option value="">All categories</option>' + cats.map(function (c) {
    return '<option>' + esc(c) + '</option>';
  }).join('');

  var tbody = document.getElementById('rows');
  var count = document.getElementById('count');

  function currentRows() {
    var q = document.getElementById('q').value.trim().toLowerCase();
    var cat = catSel.value;
    var watchOnly = document.getElementById('watch').checked;
    var sort = document.getElementById('sort').value;
    var out = rows.filter(function (r) {
      if (cat && r.category !== cat) return false;
      if (watchOnly && !r.watchlist) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      return true;
    });
    var key = {
      value: function (r) { return -r.implied_value_usd; },
      tvl: function (r) { return -r.tvl_usd; },
      growth: function (r) { return -(r.change_7d === null ? -9 : r.change_7d); },
      age: function (r) { return -(r.age_days === null ? -1 : r.age_days); },
      name: function (r) { return r.name; }
    }[sort];
    out.sort(function (a, b) {
      var ka = key(a), kb = key(b);
      return ka < kb ? -1 : ka > kb ? 1 : a.rank - b.rank;
    });
    return out;
  }

  function render() {
    var out = currentRows();
    count.textContent = out.length + ' of ' + rows.length + ' shown';
    tbody.innerHTML = out.map(function (r) {
      return '<tr data-slug="' + r.slug + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span>' +
        (r.watchlist ? '<span class="badge">WATCHLIST</span>' : '') + '</td>' +
        '<td>' + esc(r.category || '-') + '</td>' +
        '<td>' + esc(r.chains.slice(0, 3).join(', ')) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        pct(r.change_7d) +
        '<td class="num">' + (r.age_days === null ? '-' : r.age_days + 'd') + '</td>' +
        '<td class="num">' + r.multiple.toFixed(2) + 'x</td>' +
        '<td class="num val">' + money(r.implied_value_usd) + '</td></tr>';
    }).join('');
  }

  function showDetail(slug) {
    var r = bySlug[slug];
    var box = document.getElementById('detail');
    if (!r) { box.hidden = true; return; }
    var ageTxt = r.age_days === null ? 'listing date not recorded' : r.age_days + ' days listed, still no token';
    box.innerHTML =
      '<button class="close" id="dclose">Close</button>' +
      '<h2>' + esc(r.name) + ' <span class="val">' + money(r.implied_value_usd) + '</span></h2>' +
      '<p class="sub">Rank #' + r.rank + ' · ' + esc(r.category || 'Uncategorised') + ' · ' +
      esc(r.chains.join(', ')) + ' · TVL ' + money(r.tvl_usd) + ' · ' + ageTxt +
      (r.watchlist ? ' · on the $50M watchlist' : '') + '</p>' +
      '<div class="equation">' + money(r.tvl_usd) + ' TVL x <b>' + r.multiple.toFixed(3) +
      'x</b> category multiple (' + r.peers + (r.peers === 1 ? ' launched peer' : ' launched peers') + ') x <b>' + r.momentum.toFixed(3) +
      '</b> momentum x <b>' + r.age_factor.toFixed(3) + '</b> age = <b>' + money(r.implied_value_usd) + '</b></div>' +
      '<h3>Farm plan</h3><ol>' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol>';
    box.hidden = false;
    document.getElementById('dclose').addEventListener('click', function () { box.hidden = true; });
    box.scrollIntoView({ block: 'nearest' });
  }

  tbody.addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr');
    if (tr) showDetail(tr.getAttribute('data-slug'));
  });
  ['q', 'cat', 'watch', 'sort'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', render);
    document.getElementById(id).addEventListener('change', render);
  });

  // Deep links used for the screenshots and for sharing a view:
  // #p=<slug> opens a protocol, #cat=<category> filters the board.
  var hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get('cat')) catSel.value = hash.get('cat');
  if (hash.get('q')) document.getElementById('q').value = hash.get('q');
  render();
  if (hash.get('p')) showDetail(hash.get('p'));
})();
