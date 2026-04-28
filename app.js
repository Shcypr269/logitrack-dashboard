// ═══════════════════════════════════════════
// LogiTrack AI — Standalone ML Dashboard
// Calls Render ML engine directly
// ═══════════════════════════════════════════

const ML = 'https://logitrackai.onrender.com/api/v1';

async function mlPost(path, body = {}) {
  const res = await fetch(`${ML}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ML Error ${res.status}`);
  return res.json();
}
async function mlGet(path) {
  const res = await fetch(`${ML}${path}`);
  if (!res.ok) throw new Error(`ML Error ${res.status}`);
  return res.json();
}

// ═══════ Navigation ═══════
function navigate(page) {
  document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');
  document.querySelectorAll('.sidebar-nav a').forEach(a => a.classList.toggle('active', a.dataset.page === page));
  const loaders = { dashboard: loadDashboard, anomaly: loadAnomalyData, explainability: loadGlobalImportance };
  if (loaders[page]) loaders[page]();
}

// ═══════ Helpers ═══════
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

function riskBarsHtml(dist, total) {
  const levels = [['LOW','#00b894'],['MEDIUM','#fdcb6e'],['HIGH','#f39c12'],['CRITICAL','#e94560']];
  return levels.map(([k, c]) => {
    const count = dist[k] || 0;
    const pct = Math.round((count / Math.max(total, 1)) * 100);
    return `<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
      <span style="min-width:65px;font-size:12px;color:${c};font-weight:600">${k}</span>
      <div class="progress-bar" style="flex:1"><div class="fill" style="width:${pct}%;background:${c}"></div></div>
      <span style="min-width:30px;font-size:12px;color:var(--text-secondary)">${count}</span></div>`;
  }).join('');
}

function alertRowHtml(a, fleet) {
  const ship = fleet.find(f => f.shipment_id === a.shipment_id) || {};
  const lvl = (a.risk_level || 'medium').toLowerCase();
  const col = a.anomaly_score > 0.8 ? 'var(--red)' : a.anomaly_score > 0.5 ? 'var(--orange)' : 'var(--yellow)';
  return `<div class="alert-row ${lvl}">
    <div class="alert-score" style="color:${col}">${Math.round(a.anomaly_score * 100)}%</div>
    <div class="alert-info">
      <div class="alert-title">${a.shipment_id} <span class="badge ${lvl}">${a.risk_level}</span></div>
      <div class="alert-meta">${capitalize(ship.region || '?')} · ${capitalize(ship.weather_condition || '?')} · ${ship.distance_km || 0} km · ${ship.package_weight_kg || 0} kg</div>
      <div class="alert-reasons">${(a.reasons || []).slice(0, 3).map(r => `⚠️ ${r}`).join(' · ')}</div>
    </div></div>`;
}

// ═══════ Dashboard ═══════
async function loadDashboard() {
  try {
    const [anomalyData, optData] = await Promise.all([
      mlPost('/ml/anomaly-detect-batch', { fleet_size: 25 }),
      mlPost('/ml/optimize-transport', { distance_km: 500, weight_kg: 200, deadline_hours: 48 }),
    ]);
    const s = anomalyData.summary || {};
    const savings = optData.savings || {};
    document.getElementById('m-anomalies').textContent = s.anomalies_detected || 0;
    document.getElementById('m-penalties').textContent = `₹${((s.anomalies_detected || 0) * 5).toFixed(0)}K`;
    document.getElementById('m-co2').textContent = `${savings.co2_saving_kg || 0} kg`;

    const dist = anomalyData.risk_distribution || {};
    const total = (anomalyData.results || []).length;
    document.getElementById('dashRiskBars').innerHTML = riskBarsHtml(dist, total);

    const anomalies = (anomalyData.results || []).filter(r => r.is_anomaly).sort((a, b) => b.anomaly_score - a.anomaly_score).slice(0, 5);
    document.getElementById('dashAlerts').innerHTML = anomalies.length
      ? anomalies.map(a => alertRowHtml(a, anomalyData.fleet || [])).join('')
      : '<div class="empty-state"><div class="empty-icon">✅</div><p>No anomalies detected!</p></div>';
  } catch (e) {
    document.getElementById('dashAlerts').innerHTML = `<div class="empty-state"><div class="empty-icon">⏳</div><p>ML Engine warming up... Please wait 30s and refresh.<br><small style="color:var(--text-muted)">${e.message}</small></p></div>`;
  }
}

// ═══════ Anomaly Detection ═══════
async function loadAnomalyData() {
  const me = document.getElementById('anomalyMetrics');
  const ae = document.getElementById('anomalyAlerts');
  me.innerHTML = '<div class="loading-overlay"><div class="spinner"></div><p>Scanning fleet...</p></div>';
  try {
    const data = await mlPost('/ml/anomaly-detect-batch', { fleet_size: 25 });
    const s = data.summary || {};
    me.innerHTML = `
      <div class="metric-card accent"><div class="metric-icon">📦</div><div class="metric-value">${s.total_shipments||0}</div><div class="metric-label">Total Shipments</div></div>
      <div class="metric-card red"><div class="metric-icon">🚨</div><div class="metric-value">${s.anomalies_detected||0}</div><div class="metric-label">Anomalies</div></div>
      <div class="metric-card orange"><div class="metric-icon">⚠️</div><div class="metric-value">${(s.critical_alerts||0)+(s.high_alerts||0)}</div><div class="metric-label">Critical + High</div></div>
      <div class="metric-card green"><div class="metric-icon">📊</div><div class="metric-value">${Math.round((s.anomaly_rate||0)*100)}%</div><div class="metric-label">Anomaly Rate</div></div>`;

    const dist = data.risk_distribution || {};
    document.getElementById('anomalyRiskBars').innerHTML = riskBarsHtml(dist, (data.results||[]).length);

    const anomalies = (data.results||[]).filter(r => r.is_anomaly).sort((a,b) => b.anomaly_score - a.anomaly_score);
    ae.innerHTML = anomalies.length
      ? anomalies.map(a => alertRowHtml(a, data.fleet||[])).join('')
      : '<div class="empty-state"><div class="empty-icon">✅</div><p>Fleet is clean — no anomalies!</p></div>';
  } catch (e) { me.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><p>${e.message}</p></div>`; }
}

// ═══════ Transport Optimizer ═══════
function setRoute(d, w, dl) {
  document.getElementById('optDist').value = d;
  document.getElementById('optWeight').value = w;
  document.getElementById('optDeadline').value = dl;
}

async function runOptimizer() {
  const el = document.getElementById('optimizerResults');
  el.innerHTML = '<div class="loading-overlay"><div class="spinner"></div><p>Running ML optimization...</p></div>';
  try {
    const data = await mlPost('/ml/optimize-transport', {
      distance_km: +document.getElementById('optDist').value,
      weight_kg: +document.getElementById('optWeight').value,
      deadline_hours: +document.getElementById('optDeadline').value,
      priority: document.getElementById('optPriority').value,
    });
    const rec = data.recommended, alts = data.alternatives || [], sav = data.savings || {};
    if (!rec) { el.innerHTML = '<div class="card"><div class="empty-state"><div class="empty-icon">⚠️</div><p>No viable mode. Adjust params.</p></div></div>'; return; }
    el.innerHTML = `
      <div class="rec-card" style="margin-bottom:20px">
        <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:12px">
          <div><div style="font-size:20px;font-weight:700;color:var(--green)">✅ ${rec.mode}</div>
            <div style="display:flex;gap:20px;margin-top:12px;font-size:14px;flex-wrap:wrap">
              <span>💰 ₹${rec.total_cost_inr?.toLocaleString()}</span><span>⏱️ ${rec.travel_time_hrs}h</span>
              <span>🌿 ${rec.co2_emissions_kg} kg CO₂</span><span>📊 ${Math.round((rec.reliability||0)*100)}%</span></div></div>
          <div style="text-align:right"><div style="font-size:12px;color:${rec.meets_deadline?'var(--green)':'var(--red)'}">${rec.meets_deadline?'✅ Meets deadline':'⚠️ May be late'}</div>
            <div style="font-size:12px;color:var(--text-secondary);margin-top:4px">Score: ${rec.score?.toFixed(3)}</div></div></div></div>
      <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">
        <div style="flex:1;background:rgba(0,184,148,0.1);border:1px solid rgba(0,184,148,0.3);border-radius:var(--radius-sm);padding:12px 16px;text-align:center;font-size:13px;font-weight:600;color:var(--green)">💰 Saves ₹${sav.cost_saving_inr||0}</div>
        <div style="flex:1;background:rgba(0,184,148,0.1);border:1px solid rgba(0,184,148,0.3);border-radius:var(--radius-sm);padding:12px 16px;text-align:center;font-size:13px;font-weight:600;color:var(--green)">🌱 Saves ${sav.co2_saving_kg||0} kg CO₂</div></div>
      <div class="card"><div class="card-title" style="margin-bottom:16px">🔄 All Options Compared</div>
        <table class="data-table"><thead><tr><th>Mode</th><th>Cost (₹)</th><th>Time</th><th>CO₂</th><th>Reliable</th><th>Deadline</th><th>Score</th></tr></thead>
        <tbody>${alts.map(a=>`<tr style="${a.mode_id===rec.mode_id?'background:rgba(0,184,148,0.08)':''}">
          <td style="font-weight:${a.mode_id===rec.mode_id?'700':'400'}">${a.mode_id===rec.mode_id?'⭐ ':''}${a.mode}</td>
          <td>₹${a.total_cost_inr?.toLocaleString()}</td><td>${a.travel_time_hrs}h</td><td>${a.co2_emissions_kg}kg</td>
          <td>${Math.round((a.reliability||0)*100)}%</td><td>${a.meets_deadline?'✅':'❌'}</td><td>${a.score?.toFixed(3)}</td></tr>`).join('')}</tbody></table></div>`;
  } catch (e) { el.innerHTML = `<div class="card"><div class="empty-state"><div class="empty-icon">❌</div><p>${e.message}</p></div></div>`; }
}

// ═══════ What-If Simulator ═══════
async function runSimulation() {
  const el = document.getElementById('simulatorResults');
  el.innerHTML = '<div class="loading-overlay"><div class="spinner"></div><p>Simulating disruption propagation...</p></div>';
  try {
    const data = await mlPost('/ml/whatif', {
      disruption_type: document.getElementById('simType').value,
      affected_region: document.getElementById('simRegion').value,
      severity: +document.getElementById('simSeverity').value,
      fleet_size: +document.getElementById('simFleet').value,
      inject_region: true,
    });
    const imp = data.impact_summary || {}, details = data.shipment_details || [];
    el.innerHTML = `
      <div class="metrics-grid">
        <div class="metric-card accent"><div class="metric-icon">📦</div><div class="metric-value">${imp.total_shipments_analyzed||0}</div><div class="metric-label">Analyzed</div></div>
        <div class="metric-card blue"><div class="metric-icon">📍</div><div class="metric-value">${imp.shipments_in_affected_region||0}</div><div class="metric-label">In Affected Zone</div></div>
        <div class="metric-card red"><div class="metric-icon">⚠️</div><div class="metric-value">${imp.newly_at_risk||0}</div><div class="metric-label">Newly At Risk</div></div>
        <div class="metric-card orange"><div class="metric-icon">💰</div><div class="metric-value">₹${(imp.estimated_penalty_inr||0).toLocaleString()}</div><div class="metric-label">Est. Penalty</div></div>
        <div class="metric-card green"><div class="metric-icon">📈</div><div class="metric-value">${Math.round((imp.avg_delay_prob_increase||0)*100)}%</div><div class="metric-label">Avg Risk ↑</div></div>
      </div>
      <div class="card"><div class="card-title" style="margin-bottom:16px">📋 Shipment Impact Details</div>
        <table class="data-table"><thead><tr><th>Shipment</th><th>Region</th><th>Before</th><th>After</th><th>Δ</th><th>Zone</th><th>Status</th></tr></thead>
        <tbody>${details.sort((a,b)=>b.prob_increase-a.prob_increase).slice(0,20).map(d=>`<tr>
          <td style="font-weight:600">${d.shipment_id}</td><td>${capitalize(d.region)}</td>
          <td>${Math.round(d.baseline_delay_prob*100)}%</td><td>${Math.round(d.disrupted_delay_prob*100)}%</td>
          <td style="color:${d.prob_increase>0.1?'var(--red)':'var(--text-secondary)'}">+${Math.round(d.prob_increase*100)}%</td>
          <td>${d.is_in_affected_region?'🔴':'🟢'}</td>
          <td>${d.newly_at_risk?'<span class="badge critical">NEW RISK</span>':d.was_at_risk?'<span class="badge high">Already Risky</span>':'<span class="badge normal">Safe</span>'}</td></tr>`).join('')}</tbody></table></div>`;
  } catch (e) { el.innerHTML = `<div class="card"><div class="empty-state"><div class="empty-icon">❌</div><p>${e.message}</p></div></div>`; }
}

// ═══════ Explainability ═══════
async function loadGlobalImportance() {
  const el = document.getElementById('globalImportance');
  try {
    const data = await mlGet('/ml/global-importance');
    const feats = data.features || [];
    el.innerHTML = feats.slice(0, 10).map(f => `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <span style="min-width:120px;font-size:12px;font-weight:500">${f.feature}</span>
        <div class="progress-bar" style="flex:1"><div class="fill" style="width:${Math.min(f.importance * 100, 100)}%;background:var(--accent)"></div></div>
        <span style="font-size:11px;color:var(--accent);font-weight:600">${(f.importance * 100).toFixed(1)}%</span>
      </div>`).join('');
  } catch (e) { el.innerHTML = `<p style="color:var(--text-muted);font-size:12px">Could not load: ${e.message}</p>`; }
}

async function runExplain() {
  const el = document.getElementById('explainResults');
  el.innerHTML = '<div class="loading-overlay"><div class="spinner"></div><p>Analyzing with SHAP...</p></div>';
  try {
    const data = await mlPost('/ml/explain-delay', {
      delivery_partner: document.getElementById('xaiPartner').value,
      region: document.getElementById('xaiRegion').value,
      weather_condition: document.getElementById('xaiWeather').value,
      distance_km: +document.getElementById('xaiDist').value,
      package_weight_kg: +document.getElementById('xaiWeight').value,
      vehicle_type: document.getElementById('xaiVehicle').value,
      package_type: 'electronics', delivery_mode: 'standard',
    });
    if (data.error) { el.innerHTML = `<div class="card"><div class="empty-state"><p>${data.error}</p></div></div>`; return; }
    const prob = data.probability || 0;
    const pc = prob > 0.6 ? 'var(--red)' : prob > 0.3 ? 'var(--orange)' : 'var(--green)';
    const factors = data.top_factors || [];
    el.innerHTML = `
      <div class="metrics-grid" style="margin-bottom:20px">
        <div class="metric-card ${prob>0.5?'red':'green'}"><div class="metric-icon">${prob>0.5?'🔴':'🟢'}</div><div class="metric-value" style="color:${pc}">${Math.round(prob*100)}%</div><div class="metric-label">Delay Probability</div></div>
        <div class="metric-card accent"><div class="metric-icon">📊</div><div class="metric-value">${data.risk_level||'?'}</div><div class="metric-label">Risk Level</div></div>
        <div class="metric-card blue"><div class="metric-icon">${data.prediction==='Delayed'?'⏰':'✅'}</div><div class="metric-value">${data.prediction||'?'}</div><div class="metric-label">Prediction</div></div>
      </div>
      <div class="card" style="margin-bottom:20px;border-left:3px solid var(--accent)">
        <div style="font-size:14px;line-height:1.7">💡 ${data.explanation||'No explanation available.'}</div></div>
      <div class="card"><div class="card-title" style="margin-bottom:16px">📊 Feature Contributions (SHAP)</div>
        ${factors.map(f=>`<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;padding:10px;background:var(--bg-glass);border-radius:var(--radius-sm)">
          <span style="min-width:140px;font-size:13px;font-weight:500">${f.feature}</span>
          <div class="progress-bar" style="flex:1"><div class="fill" style="width:${Math.min(f.importance,100)}%;background:${f.direction==='increases_risk'?'var(--red)':'var(--green)'}"></div></div>
          <span style="min-width:50px;font-size:12px;color:var(--accent);font-weight:600">${f.importance}%</span>
          <span style="font-size:11px;color:${f.direction==='increases_risk'?'var(--red)':'var(--green)'}">${f.direction==='increases_risk'?'↑ risk':'↓ risk'}</span></div>`).join('')}</div>`;
  } catch (e) { el.innerHTML = `<div class="card"><div class="empty-state"><div class="empty-icon">❌</div><p>${e.message}</p></div></div>`; }
}

// ═══════ Init ═══════
loadDashboard();
