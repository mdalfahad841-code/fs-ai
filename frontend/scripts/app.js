/* FS AI — shared real data + helpers. Browser globals; no server, no fake data. */
(function () {
  'use strict';

  var DIVISIONS = [
    { id: 'automotive', name: 'Automotive', short: 'Automotive', tagline: 'Cars, bikes and the road ahead.', description: 'Practical guides to buying, maintaining and understanding cars and motorcycles — from EV charging to warning lights.', icon: '🚗', color: '#2878FF', articleCount: 12 },
    { id: 'ai-technology', name: 'AI & Technology', short: 'AI & Technology', tagline: 'AI explained in plain English.', description: 'Beginner-friendly explainers and honest guides to free AI tools that actually save time.', icon: '🤖', color: '#19C37D', articleCount: 2 },
    { id: 'gadgets-electronics', name: 'Gadgets & Electronics', short: 'Gadgets & Electronics', tagline: 'Buy the right device, once.', description: 'Buying guides for phones, laptops and tablets — what matters, what does not, and what to pay.', icon: '📱', color: '#F5A623', articleCount: 2 },
    { id: 'finance-money', name: 'Finance & Money', short: 'Finance & Money', tagline: 'Money, explained simply.', description: 'Budgeting, saving and borrowing explained in plain language — no jargon, no promises.', icon: '💰', color: '#19C37D', articleCount: 3 },
    { id: 'travel-lifestyle', name: 'Travel & Lifestyle', short: 'Travel & Lifestyle', tagline: 'Travel well, spend wisely.', description: 'Budget trips, road-trip checklists and planning guides for travel that fits your pocket.', icon: '✈️', color: '#2878FF', articleCount: 2 },
    { id: 'digital-tools', name: 'Digital Tools', short: 'Digital Tools', tagline: 'Free tools, ready to use.', description: 'Converters and calculators you can use today — no sign-up, no download, no cost.', icon: '🧰', color: '#8995A7', articleCount: 1 },
    { id: 'health-wellness', name: 'Health & Wellness', short: 'Health & Wellness', tagline: 'Small steps, every day.', description: 'Beginner fitness and wellbeing guides — walking, home workouts and habits that stick.', icon: '❤️', color: '#F5A623', articleCount: 2 },
    { id: 'education-learning', name: 'Education & Learning', short: 'Education & Learning', tagline: 'Learn a new skill in 30 days.', description: 'Practical learning guides for digital skills — structured, realistic and free to start.', icon: '🎓', color: '#2878FF', articleCount: 1 }
  ];

  var ARTICLES = [
    { id: 1, title: "EV Charging at Home: A Complete Beginner's Guide", division: 'Automotive', category: 'Electric Vehicles', date: '2026-11-11', excerpt: 'Home chargers, charging speeds, costs and safety — everything a first-time EV owner needs before plugging in.' },
    { id: 2, title: 'Car Maintenance Checklist: 12 Things to Check Every Month', division: 'Automotive', category: 'Maintenance', date: '2026-11-10', excerpt: 'Twelve simple monthly checks — oil, tyres, brakes, lights and fluids — that prevent expensive repairs.' },
    { id: 3, title: 'Hybrid vs Petrol: Which Saves You More in 2026?', division: 'Automotive', category: 'Buying Guide', date: '2026-11-09', excerpt: 'Fuel, servicing and resale compared honestly, so you can see which one really costs less over five years.' },
    { id: 4, title: 'Motorcycle Buying Guide: How to Choose Your First Bike', division: 'Automotive', category: 'Buying Guide', date: '2026-11-08', excerpt: 'Engine size, riding position, safety gear and running costs — a first-bike guide without the sales talk.' },
    { id: 5, title: "How to Read Your Car's Warning Lights", division: 'Automotive', category: 'Maintenance', date: '2026-11-07', excerpt: 'What each dashboard light means, which ones need immediate action, and which can wait for the workshop.' },
    { id: 6, title: 'Fuel Economy: 15 Proven Ways to Save Fuel', division: 'Automotive', category: 'Driving Tips', date: '2026-11-06', excerpt: 'Driving habits, tyre pressure and servicing — fifteen proven ways to cut fuel use without buying a new car.' },
    { id: 7, title: 'ADAS Explained: How Driver Assistance Really Works', division: 'Automotive', category: 'Technology', date: '2026-11-05', excerpt: 'Lane assist, automatic braking and adaptive cruise — what ADAS can do, and what it cannot do for you.' },
    { id: 8, title: 'Electric Vehicle Range: What the Numbers Really Mean', division: 'Automotive', category: 'Electric Vehicles', date: '2026-11-04', excerpt: 'WLTP range, real-world range and winter range — how to read the numbers before you buy an EV.' },
    { id: 9, title: 'How to Diagnose Common Engine Noises', division: 'Automotive', category: 'Maintenance', date: '2026-11-03', excerpt: 'Knocks, squeals, rattles and hisses — what common engine noises usually mean and when to stop driving.' },
    { id: 10, title: 'New vs Used Cars: A Practical Buying Guide', division: 'Automotive', category: 'Buying Guide', date: '2026-11-02', excerpt: 'Depreciation, warranty, inspection and finance — the real trade-offs between new and used, side by side.' },
    { id: 11, title: 'Car Safety Ratings Explained', division: 'Automotive', category: 'Safety', date: '2026-11-01', excerpt: 'Crash-test stars, active safety and what a five-star rating does — and does not — guarantee.' },
    { id: 12, title: 'Best Family Cars Compared: Space, Safety and Running Costs', division: 'Automotive', category: 'Comparison', date: '2026-10-31', excerpt: 'Space, safety and running costs compared across popular family cars, so the choice fits your family.' },
    { id: 13, title: 'What Is AI? A Plain-English Guide for Beginners', division: 'AI & Technology', category: 'Explainer', date: '2026-11-11', excerpt: 'No jargon, no hype: what AI actually is, how it works in everyday tools, and where it helps — and where it does not.' },
    { id: 14, title: '7 Free AI Tools That Actually Save Time', division: 'AI & Technology', category: 'Tools', date: '2026-11-10', excerpt: 'Seven genuinely free AI tools, tested for real tasks — writing, research, images and everyday work.' },
    { id: 15, title: 'Smartphone Buying Guide 2026: What Matters Most', division: 'Gadgets & Electronics', category: 'Buying Guide', date: '2026-11-09', excerpt: 'Camera, battery, storage and software support — the four things that decide whether a phone is worth its price.' },
    { id: 16, title: 'Laptop vs Tablet: Which One Should You Buy?', division: 'Gadgets & Electronics', category: 'Comparison', date: '2026-11-08', excerpt: 'Work, study, drawing and travel — which device fits your day, and when one device is not enough.' },
    { id: 17, title: 'Monthly Budgeting: The 50/30/20 Rule Explained', division: 'Finance & Money', category: 'Budgeting', date: '2026-11-07', excerpt: 'Needs, wants and savings in one simple split — how the 50/30/20 rule works on a real monthly income.' },
    { id: 18, title: 'How to Start Saving With a Small Income', division: 'Finance & Money', category: 'Saving', date: '2026-11-06', excerpt: 'Saving is a habit before it is an amount. Small, automatic steps that work even on a tight income.' },
    { id: 19, title: 'Travel on a Budget: Plan a Trip Without Overspending', division: 'Travel & Lifestyle', category: 'Budget Travel', date: '2026-11-05', excerpt: 'Transport, stays and food — a step-by-step plan for a trip that stays inside your budget.' },
    { id: 20, title: 'Free Digital Tools: Converters and Calculators You Can Use Today', division: 'Digital Tools', category: 'Tools', date: '2026-11-04', excerpt: 'Twenty free converters and calculators on this site — fuel, budget, loans, units, dates and more.' },
    { id: 21, title: "Walking for Health: A Beginner's Fitness Guide", division: 'Health & Wellness', category: 'Fitness', date: '2026-11-03', excerpt: 'How much walking helps, how to start safely, and how to build a daily habit that actually lasts.' },
    { id: 22, title: 'How to Learn a New Digital Skill in 30 Days', division: 'Education & Learning', category: 'Learning', date: '2026-11-02', excerpt: 'One skill, thirty days, thirty minutes a day — a realistic plan with daily milestones and free resources.' },
    { id: 23, title: 'Home Workout Basics: No Equipment Needed', division: 'Health & Wellness', category: 'Fitness', date: '2026-11-01', excerpt: 'Bodyweight exercises, a simple weekly routine and safe form — a home workout that needs no equipment.' },
    { id: 24, title: 'Understanding Interest: Loans Explained Simply', division: 'Finance & Money', category: 'Loans', date: '2026-10-31', excerpt: 'Simple interest, compound interest and monthly payments — what a loan really costs, worked out step by step.' },
    { id: 25, title: 'How to Plan a Road Trip: Checklist and Costs', division: 'Travel & Lifestyle', category: 'Road Trips', date: '2026-10-30', excerpt: 'Route, fuel, stays, food and safety — a complete road-trip checklist with a realistic cost breakdown.' }
  ];

  var TOOLS = [
    { id: 'fuel-cost', name: 'Fuel Cost', category: 'Automotive', description: 'Total fuel cost for a trip from distance, consumption and fuel price.' },
    { id: 'mileage', name: 'Mileage', category: 'Automotive', description: 'Fuel economy in km/l and l/100 km from distance driven and fuel used.' },
    { id: 'maintenance-planner', name: 'Vehicle Maintenance Planner', category: 'Automotive', description: 'Next service date and distance from your last service and interval.' },
    { id: 'tyre-pressure', name: 'Tyre Pressure Guide', category: 'Automotive', description: 'Convert tyre pressure between PSI, bar and kPa.' },
    { id: 'monthly-budget', name: 'Monthly Budget', category: 'Finance', description: 'Split your income with the 50/30/20 rule: needs, wants, savings.' },
    { id: 'savings', name: 'Savings', category: 'Finance', description: 'Future value of regular savings with compound interest.' },
    { id: 'loan-payment', name: 'Loan Payment Estimator', category: 'Finance', description: 'Monthly loan payment from amount, annual rate and term.' },
    { id: 'currency-converter', name: 'Currency Converter', category: 'Finance', description: 'Convert an amount with a rate you enter yourself. No live rates are used — never enter a rate you have not checked.' },
    { id: 'storage-converter', name: 'Storage Converter', category: 'Digital', description: 'Convert between bytes, KB, MB, GB and TB.' },
    { id: 'internet-speed', name: 'Internet Speed Converter', category: 'Digital', description: 'Convert between Mbps, MB/s, Kbps and Gbps.' },
    { id: 'data-unit', name: 'Data Unit Converter', category: 'Digital', description: 'Convert data amounts between bits, bytes, KB, MB, GB and TB.' },
    { id: 'file-size', name: 'File Size Calculator', category: 'Digital', description: 'Estimate download time from file size and connection speed.' },
    { id: 'travel-budget', name: 'Travel Budget', category: 'Travel', description: 'Total trip budget from daily costs, days and transport.' },
    { id: 'distance-planner', name: 'Distance Planner', category: 'Travel', description: 'Travel time and fuel needed from distance and average speed.' },
    { id: 'trip-cost', name: 'Trip Cost Estimator', category: 'Travel', description: 'Full trip cost: fuel, tolls, food and stays.' },
    { id: 'age-calculator', name: 'Age Calculator', category: 'Everyday', description: 'Exact age in years, months and days from a date of birth.' },
    { id: 'percentage', name: 'Percentage Calculator', category: 'Everyday', description: 'Find a percentage of a number, or what percentage one number is of another.' },
    { id: 'date-calculator', name: 'Date Calculator', category: 'Everyday', description: 'Days between two dates, or a date a number of days from today.' },
    { id: 'unit-converter', name: 'Unit Converter', category: 'Everyday', description: 'Convert length, weight and temperature between common units.' },
    { id: 'time-calculator', name: 'Time Calculator', category: 'Everyday', description: 'Add or subtract hours and minutes, and find the difference between two times.' }
  ];

  var AGENTS = [
    { id: 'business-manager', name: 'Business Manager', role: 'Central coordination', status: 'Ready' },
    { id: 'automotive-research', name: 'Automotive Research', role: 'Automotive division research', status: 'Ready' },
    { id: 'technology-research', name: 'Technology Research', role: 'AI & Technology research', status: 'Ready' },
    { id: 'gadget-research', name: 'Gadget Research', role: 'Gadgets & Electronics research', status: 'Ready' },
    { id: 'finance-research', name: 'Finance Research', role: 'Finance & Money research', status: 'Ready' },
    { id: 'travel-research', name: 'Travel Research', role: 'Travel & Lifestyle research', status: 'Ready' },
    { id: 'digital-tools', name: 'Digital Tools', role: 'Tools division', status: 'Ready' },
    { id: 'health-research', name: 'Health Research', role: 'Health & Wellness research', status: 'Ready' },
    { id: 'education-research', name: 'Education Research', role: 'Education & Learning research', status: 'Ready' },
    { id: 'seo', name: 'SEO', role: 'Search optimisation', status: 'Ready' },
    { id: 'content-creation', name: 'Content Creation', role: 'Article drafting', status: 'Ready' },
    { id: 'fact-checking', name: 'Fact Checking', role: 'Accuracy verification', status: 'Ready' },
    { id: 'publishing', name: 'Publishing', role: 'Publishing after owner approval', status: 'Ready' },
    { id: 'analytics', name: 'Analytics', role: 'Performance reporting', status: 'Ready' },
    { id: 'monetization', name: 'Monetization', role: 'Ad income (ads only)', status: 'Ready' },
    { id: 'security', name: 'Security', role: 'Security & monitoring', status: 'Ready' }
  ];

  var ACCOUNTS = [
    { name: 'GitHub', handle: 'mdalfahad841-code/fs-ai', url: 'https://github.com/mdalfahad841-code/fs-ai', status: 'Exists' },
    { name: 'YouTube', handle: '@FSAI-e5f', url: 'https://www.youtube.com/@FSAI-e5f', status: 'Exists' },
    { name: 'Pinterest', handle: 'watchwithf', url: 'https://www.pinterest.com/watchwithf/', status: 'Exists' },
    { name: 'Facebook', handle: null, url: null, status: 'Pending' },
    { name: 'WhatsApp Business', handle: null, url: null, status: 'Pending' },
    { name: 'Business Email', handle: null, url: null, status: 'Pending' },
    { name: 'Search Console', handle: null, url: null, status: 'Pending' },
    { name: 'Analytics', handle: null, url: null, status: 'Pending' },
    { name: 'AdSense', handle: null, url: null, status: 'Pending' },
    { name: 'Affiliate', handle: null, url: null, status: 'Pending' }
  ];

  var SITE = {
    name: 'FS AI', fullName: 'FAHAD SOMRAT AI', tagline: 'One Platform. Multiple Possibilities.',
    hero: 'EXPLORE MORE. KNOW MORE. DO MORE.',
    founder: 'Fahad Somrat',
    revenue: '$0.00', traffic: 'Data unavailable',
    contactEmail: 'mdalfahad841@gmail.com'
  };

  function divisionById(id) { return DIVISIONS.find(function (d) { return d.id === id; }) || null; }
  function articlesByDivision(name) { return ARTICLES.filter(function (a) { return a.division === name; }); }
  function articleById(id) { return ARTICLES.find(function (a) { return a.id === Number(id); }) || null; }
  function countsByDivision() {
    return DIVISIONS.map(function (d) {
      return { division: d.name, count: articlesByDivision(d.name).length };
    });
  }
  function formatDate(iso) {
    var d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  window.FSAI = {
    SITE: SITE, DIVISIONS: DIVISIONS, ARTICLES: ARTICLES, TOOLS: TOOLS, AGENTS: AGENTS, ACCOUNTS: ACCOUNTS,
    divisionById: divisionById, articlesByDivision: articlesByDivision, articleById: articleById,
    countsByDivision: countsByDivision, formatDate: formatDate, esc: esc
  };

  /* Shared rendering: header, footer, division grid, article cards, tools grid. */
  function renderHeader(active) {
    var nav = [
      ['index.html', 'Home'], ['pages/division.html', 'Divisions'], ['pages/tools.html', 'Tools']
    ];
    /* Pages live one level deeper; fix relative links when on a sub-page. */
    var inPages = window.location.pathname.indexOf('/pages/') !== -1;
    var prefix = inPages ? '../' : '';
    var links = nav.map(function (n) {
      var href = n[0].indexOf('pages/') === 0 ? (inPages ? n[0].replace('pages/', '') : n[0]) : prefix + n[0];
      var cls = (active === n[1]) ? ' class="active" aria-current="page"' : '';
      return '<a href="' + href + '"' + cls + '>' + n[1] + '</a>';
    }).join('');
    return '<header class="site-header"><div class="wrap header-inner">' +
      '<a class="brand" href="' + prefix + 'index.html"><span class="brand-mark">FS</span><span class="brand-text"><strong>FS AI</strong><small>FAHAD SOMRAT AI</small></span></a>' +
      '<nav class="main-nav" aria-label="Main navigation">' + links + '</nav>' +
      '<div class="header-actions"><button class="theme-toggle" id="themeToggle" type="button" aria-label="Switch light and dark theme">☀️ / 🌙</button>' +
      '<button class="nav-toggle" id="navToggle" type="button" aria-label="Open menu" aria-expanded="false">☰</button></div></div></header>';
  }

  function renderFooter() {
    var inPages = window.location.pathname.indexOf('/pages/') !== -1;
    var prefix = inPages ? '../' : '';
    var existing = ACCOUNTS.filter(function (a) { return a.status === 'Exists'; });
    var pending = ACCOUNTS.filter(function (a) { return a.status === 'Pending'; });
    var links = existing.map(function (a) {
      return '<a href="' + a.url + '" target="_blank" rel="noopener">' + esc(a.name) + ' (' + esc(a.handle) + ')</a>';
    }).join(' · ');
    return '<footer class="site-footer"><div class="wrap footer-grid">' +
      '<div><h3>FS AI</h3><p>FAHAD SOMRAT AI — One Platform. Multiple Possibilities.</p>' +
      '<p>Founded by Fahad Somrat. Zero-cost platform: no paid services, no fake numbers.</p></div>' +
      '<div><h3>Divisions</h3><p>' + DIVISIONS.map(function (d) { return '<a href="' + prefix + 'pages/division.html?division=' + d.id + '">' + esc(d.name) + '</a>'; }).join(' · ') + '</p></div>' +
      '<div><h3>Accounts</h3><p>' + links + '</p><p>Pending — not yet created or connected: ' + pending.map(function (a) { return esc(a.name); }).join(', ') + '.</p></div>' +
      '<div><h3>Honest numbers</h3><p>Revenue: $0.00<br>Traffic: Data unavailable<br>Articles: ' + ARTICLES.length + ' · Divisions: ' + DIVISIONS.length + ' · Tools: ' + TOOLS.length + '</p></div>' +
      '</div><div class="wrap footer-bottom"><p>© 2026 FS AI — Fahad Somrat. All content is free to read. No personal or family content is used on this platform.</p></div></footer>';
  }

  function articleCard(a) {
    return '<article class="card article-card reveal"><div class="card-tag">' + esc(a.division) + ' · ' + esc(a.category) + '</div>' +
      '<h3><a href="pages/article.html?id=' + a.id + '">' + esc(a.title) + '</a></h3>' +
      '<p>' + esc(a.excerpt) + '</p><time datetime="' + a.date + '">' + formatDate(a.date) + '</time> ' +
      '<a class="read-more" href="pages/article.html?id=' + a.id + '">Read article →</a></article>';
  }
  /* articleCard links are written from the site root; fix them when rendered on a sub-page. */
  function fixArticleLinks(root) {
    if (window.location.pathname.indexOf('/pages/') === -1) return;
    root.querySelectorAll('a[href^="pages/"]').forEach(function (a) { a.setAttribute('href', a.getAttribute('href').replace(/^pages\//, '')); });
  }

  function renderDivisions(root) {
    if (!root) return;
    root.innerHTML = DIVISIONS.map(function (d) {
      return '<article class="card division-card reveal" style="--div-color:' + d.color + '">' +
        '<div class="div-icon" aria-hidden="true">' + d.icon + '</div><h3>' + esc(d.name) + '</h3>' +
        '<p class="div-tagline">' + esc(d.tagline) + '</p><p>' + esc(d.description) + '</p>' +
        '<p class="div-count">' + d.articleCount + ' article' + (d.articleCount === 1 ? '' : 's') + '</p>' +
        '<a class="btn btn-outline" href="pages/division.html?division=' + d.id + '">Explore ' + esc(d.short) + ' →</a></article>';
    }).join('');
    fixArticleLinks(root);
  }

  function renderArticles(root, list) {
    if (!root) return;
    var items = list || ARTICLES.slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
    root.innerHTML = items.map(articleCard).join('') || '<p>No articles found.</p>';
    fixArticleLinks(root);
  }

  function renderTools(root) {
    if (!root) return;
    root.innerHTML = TOOLS.map(function (t) {
      return '<article class="card tool-card reveal"><h3>' + esc(t.name) + '</h3><p class="card-tag">' + esc(t.category) + '</p><p>' + esc(t.description) + '</p>' +
        '<a class="btn btn-outline" href="pages/tools.html?tool=' + t.id + '">Open tool →</a></article>';
    }).join('');
    fixArticleLinks(root);
  }

  window.FSAI.renderHeader = renderHeader;
  window.FSAI.renderFooter = renderFooter;
  window.FSAI.renderDivisions = renderDivisions;
  window.FSAI.renderArticles = renderArticles;
  window.FSAI.renderTools = renderTools;
  window.FSAI.articleCard = articleCard;

  document.addEventListener('DOMContentLoaded', function () {
    var h = document.getElementById('siteHeader');
    if (h) h.innerHTML = renderHeader(h.getAttribute('data-active') || 'Home');
    var f = document.getElementById('siteFooter');
    if (f) f.innerHTML = renderFooter();
    var dg = document.getElementById('divisionGrid');
    if (dg) renderDivisions(dg);
    var ag = document.getElementById('articleGrid');
    if (ag) renderArticles(ag);
    var tg = document.getElementById('toolGrid');
    if (tg) renderTools(tg);
    var y = document.getElementById('year');
    if (y) y.textContent = '2026';
  });
})();
