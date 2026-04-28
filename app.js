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
  const loaders = { dashboard: loadDashboard, anomaly: loadAnomalyData, explainability: loadGlobalImportance, livemap: loadLiveMap };
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

// ═══════ Indian Cities & Corridors ═══════
const CITIES = {
  mumbai: { lat: 19.076, lng: 72.877, name: 'Mumbai' },
  delhi: { lat: 28.613, lng: 77.209, name: 'Delhi' },
  bangalore: { lat: 12.971, lng: 77.594, name: 'Bangalore' },
  chennai: { lat: 13.082, lng: 80.270, name: 'Chennai' },
  kolkata: { lat: 22.572, lng: 88.363, name: 'Kolkata' },
  hyderabad: { lat: 17.385, lng: 78.486, name: 'Hyderabad' },
  ahmedabad: { lat: 23.022, lng: 72.571, name: 'Ahmedabad' },
  pune: { lat: 18.520, lng: 73.856, name: 'Pune' },
  jaipur: { lat: 26.912, lng: 75.787, name: 'Jaipur' },
  lucknow: { lat: 26.846, lng: 80.946, name: 'Lucknow' },
  bhopal: { lat: 23.259, lng: 77.412, name: 'Bhopal' },
  patna: { lat: 25.611, lng: 85.144, name: 'Patna' },
};

const CORRIDORS = [
  ['mumbai', 'delhi', '#6c5ce7'], ['bangalore', 'chennai', '#00b894'],
  ['delhi', 'kolkata', '#0984e3'], ['mumbai', 'bangalore', '#e94560'],
  ['hyderabad', 'mumbai', '#f39c12'], ['delhi', 'jaipur', '#a29bfe'],
  ['kolkata', 'patna', '#fdcb6e'], ['mumbai', 'ahmedabad', '#55efc4'],
  ['delhi', 'lucknow', '#74b9ff'], ['hyderabad', 'chennai', '#fab1a0'],
  ['bhopal', 'mumbai', '#ff7675'], ['pune', 'bangalore', '#81ecec'],
];

const REGION_CITIES = {
  north: ['delhi', 'jaipur', 'lucknow'],
  south: ['bangalore', 'chennai', 'hyderabad'],
  east: ['kolkata', 'patna'],
  west: ['mumbai', 'ahmedabad', 'pune'],
  central: ['bhopal'],
};

function getShipmentPosition(ship) {
  // Place shipment deterministically between its origin and destination city
  const originKey = (ship.origin || '').toLowerCase();
  const destKey = (ship.destination || '').toLowerCase();
  const originCity = CITIES[originKey];
  const destCity = CITIES[destKey];

  if (originCity && destCity) {
    // Use shipment_id hash to get a stable position along the corridor
    let hash = 0;
    const id = ship.shipment_id || '';
    for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash) + id.charCodeAt(i);
    const t = 0.2 + (Math.abs(hash % 60) / 100); // 0.20 to 0.80 along corridor
    const jitter = (Math.abs(hash % 100) - 50) / 200; // small perpendicular offset
    return {
      lat: originCity.lat + (destCity.lat - originCity.lat) * t + jitter,
      lng: originCity.lng + (destCity.lng - originCity.lng) * t - jitter,
    };
  }
  // Fallback: place near a region city
  const region = (ship.region || 'central').toLowerCase();
  const cities = REGION_CITIES[region] || REGION_CITIES.central;
  const city = CITIES[cities[0]];
  return { lat: city.lat + 0.3, lng: city.lng + 0.3 };
}

function riskColor(level) {
  const l = (level || 'low').toUpperCase();
  if (l === 'CRITICAL') return '#e94560';
  if (l === 'HIGH') return '#f39c12';
  if (l === 'MEDIUM') return '#fdcb6e';
  return '#00b894';
}

let fleetMap = null;

async function loadLiveMap() {
  const metricsEl = document.getElementById('mapMetrics');
  const tableEl = document.getElementById('mapFleetTable');
  metricsEl.innerHTML = '<div class="loading-overlay"><div class="spinner"></div><p>Loading fleet data...</p></div>';

  try {
    const data = await mlGet('/ml/fleet-scan');
    const fleet = data.fleet || [];
    const results = data.results || [];
    const summary = data.summary || {};

    // Build result lookup
    const rMap = {};
    results.forEach(r => { rMap[r.shipment_id] = r; });

    // Metrics
    metricsEl.innerHTML = `
      <div class="metric-card accent"><div class="metric-icon">📦</div><div class="metric-value">${fleet.length}</div><div class="metric-label">Active Shipments</div></div>
      <div class="metric-card red"><div class="metric-icon">🚨</div><div class="metric-value">${summary.anomalies_detected || 0}</div><div class="metric-label">Anomalies</div></div>
      <div class="metric-card green"><div class="metric-icon">✅</div><div class="metric-value">${fleet.length - (summary.anomalies_detected || 0)}</div><div class="metric-label">On Track</div></div>
      <div class="metric-card blue"><div class="metric-icon">🗺️</div><div class="metric-value">${new Set(fleet.map(f=>f.region)).size}</div><div class="metric-label">Regions Active</div></div>`;

    // Init map
    if (fleetMap) { fleetMap.remove(); fleetMap = null; }
    fleetMap = L.map('fleetMap', { zoomControl: true, attributionControl: false }).setView([22.5, 79], 5);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 18,
    }).addTo(fleetMap);

    // Draw corridors
    CORRIDORS.forEach(([from, to, color]) => {
      const c1 = CITIES[from], c2 = CITIES[to];
      L.polyline([[c1.lat, c1.lng], [c2.lat, c2.lng]], {
        color: color, weight: 2, opacity: 0.35, dashArray: '8, 6',
      }).addTo(fleetMap);
    });

    // Draw city hubs
    Object.values(CITIES).forEach(city => {
      L.circleMarker([city.lat, city.lng], {
        radius: 6, color: '#6c5ce7', fillColor: '#6c5ce7', fillOpacity: 0.7, weight: 1,
      }).addTo(fleetMap).bindTooltip(city.name, {
        permanent: true, direction: 'top', offset: [0, -8],
        className: 'city-label',
      });
    });

    // Place fleet markers
    fleet.forEach(ship => {
      const pos = getShipmentPosition(ship);
      const res = rMap[ship.shipment_id] || {};
      const isAnomaly = res.is_anomaly || false;
      const risk = res.risk_level || 'LOW';
      const color = riskColor(risk);
      const score = Math.round((res.anomaly_score || 0) * 100);

      const marker = L.circleMarker([pos.lat, pos.lng], {
        radius: isAnomaly ? 9 : 6,
        color: color,
        fillColor: color,
        fillOpacity: isAnomaly ? 0.9 : 0.5,
        weight: isAnomaly ? 3 : 1,
      }).addTo(fleetMap);

      marker.bindPopup(`
        <div style="font-family:Inter,sans-serif;min-width:200px">
          <div style="font-weight:700;font-size:14px;margin-bottom:6px">${ship.shipment_id}</div>
          <div style="font-size:12px;color:#666;margin-bottom:8px">${capitalize(ship.region)} · ${capitalize(ship.weather_condition)} · ${ship.vehicle_type}</div>
          <div style="display:flex;gap:12px;font-size:12px">
            <span>📏 ${ship.distance_km} km</span>
            <span>📦 ${ship.package_weight_kg} kg</span>
          </div>
          <div style="margin-top:8px;padding:6px 10px;border-radius:6px;background:${color}22;color:${color};font-weight:600;font-size:12px;text-align:center">
            ${isAnomaly ? `🚨 ${risk} — Score: ${score}%` : '✅ Normal'}
          </div>
          ${isAnomaly && res.reasons ? `<div style="margin-top:6px;font-size:11px;color:#888">${res.reasons.slice(0,2).map(r=>'⚠️ '+r).join('<br>')}</div>` : ''}
        </div>
      `);
    });

    // Fleet table
    tableEl.innerHTML = `<table class="data-table">
      <thead><tr><th>Shipment</th><th>Region</th><th>Weather</th><th>Distance</th><th>Weight</th><th>Vehicle</th><th>Risk</th></tr></thead>
      <tbody>${fleet.map(s => {
        const r = rMap[s.shipment_id] || {};
        const lvl = (r.risk_level || 'LOW').toLowerCase();
        return `<tr>
          <td style="font-weight:600">${s.shipment_id}</td>
          <td>${capitalize(s.region)}</td>
          <td>${capitalize(s.weather_condition)}</td>
          <td>${s.distance_km} km</td>
          <td>${s.package_weight_kg} kg</td>
          <td>${capitalize(s.vehicle_type)}</td>
          <td><span class="badge ${lvl}">${r.risk_level || 'LOW'}</span></td>
        </tr>`;
      }).join('')}</tbody></table>`;

    // Force map resize
    setTimeout(() => fleetMap.invalidateSize(), 200);
  } catch (e) {
    metricsEl.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><p>${e.message}</p></div>`;
  }
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
    const [metrics, fleetScan] = await Promise.all([
      mlGet('/ml/impact-metrics'),
      mlGet('/ml/fleet-scan')
    ]);

    // Update Impact Metrics Panel
    document.getElementById('m-anomalies').textContent = metrics.disruptions_caught || 0;
    document.getElementById('m-penalties').textContent = `₹${(metrics.penalties_prevented_inr/1000).toFixed(0)}K`;
    document.getElementById('m-co2').textContent = `${metrics.co2_saved_kg || 0} kg`;

    // Update Fleet Anomaly Status
    const dist = fleetScan.risk_distribution || {};
    const total = (fleetScan.results || []).length;
    document.getElementById('dashRiskBars').innerHTML = riskBarsHtml(dist, total);

    const anomalies = (fleetScan.results || []).filter(r => r.is_anomaly).sort((a, b) => b.anomaly_score - a.anomaly_score).slice(0, 5);
    document.getElementById('dashAlerts').innerHTML = anomalies.length
      ? anomalies.map(a => alertRowHtml(a, fleetScan.fleet || [])).join('')
      : '<div class="empty-state"><div class="empty-icon">✅</div><p>No anomalies detected in the fleet.</p></div>';
      
    // Auto-trigger reroute on dashboard load
    triggerAutoReroute();
  } catch (e) {
    document.getElementById('dashAlerts').innerHTML = `<div class="empty-state"><div class="empty-icon">⏳</div><p>ML Engine warming up... Please wait 30s and refresh.<br><small style="color:var(--text-muted)">${e.message}</small></p></div>`;
  }
}

async function triggerAutoReroute() {
  const feed = document.getElementById('autoRerouteFeed');
  feed.innerHTML = '<div class="loading-overlay"><div class="spinner"></div><p>Executing autonomous reroute protocol...</p></div>';
  
  try {
    const data = await mlGet('/ml/auto-reroute');
    const rerouted = data.rerouted_shipments || [];
    
    if (rerouted.length === 0) {
      feed.innerHTML = '<div class="empty-state"><div class="empty-icon">✅</div><p>Fleet healthy. No critical reroutes needed.</p></div>';
      return;
    }
    
    let html = `<div style="margin-bottom:15px; font-weight:600; color:var(--green)">✅ Successfully optimized ${rerouted.length} critical shipments.</div>`;
    html += `<div style="display:flex; gap:10px; margin-bottom:15px">
               <span class="badge blue">Saves ₹${data.impact.total_cost_saved_inr.toLocaleString()}</span>
               <span class="badge green">Saves ${data.impact.total_time_saved_hrs} hours</span>
             </div>`;
             
    html += rerouted.map(r => `
      <div style="border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 10px; background: var(--bg-glass);">
        <div style="display:flex; justify-content:space-between; margin-bottom: 8px;">
          <strong style="color:var(--text)">${r.shipment_id}</strong>
          <span class="badge ${r.risk_level.toLowerCase()}">${r.risk_level} Risk</span>
        </div>
        <div style="font-size:12px; color:var(--text-secondary); margin-bottom: 8px;">
          📍 ${r.origin} → ${r.destination}
        </div>
        <div style="font-size:12px; padding: 6px; background: rgba(255,100,100,0.1); border-radius: 4px; margin-bottom: 8px; border-left: 2px solid var(--red);">
          <strong>Before:</strong> ${r.original_mode.toUpperCase()} (High Delay Probability)
        </div>
        <div style="font-size:12px; padding: 6px; background: rgba(100,255,100,0.1); border-radius: 4px; border-left: 2px solid var(--green);">
          <strong>After:</strong> Auto-switched to ${r.recommended_mode.toUpperCase()}<br>
          <span style="color:var(--text-secondary)">Cost: ₹${r.recommended_cost.toLocaleString()} · Time: ${r.recommended_time}h</span>
        </div>
      </div>
    `).join('');
    
    feed.innerHTML = html;
  } catch (e) {
    feed.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><p>Failed to execute reroute: ${e.message}</p></div>`;
  }
}


// ═══════ Anomaly Detection ═══════
async function loadAnomalyData() {
  const me = document.getElementById('anomalyMetrics');
  const ae = document.getElementById('anomalyAlerts');
  me.innerHTML = '<div class="loading-overlay"><div class="spinner"></div><p>Scanning fleet...</p></div>';
  try {
    const data = await mlGet('/ml/fleet-scan');
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
// ═══════ Ask LogiTrack AI (Gemini Chat) ═══════

const CHAT_REGIONS = {
  mumbai:'west',delhi:'north',bangalore:'south',chennai:'south',kolkata:'east',
  hyderabad:'south',pune:'west',ahmedabad:'west',jaipur:'north',lucknow:'north',bhopal:'central',patna:'east'
};

function localParseChat(q) {
  q = q.toLowerCase();
  const distM = q.match(/(\d+)\s*km/); const dist = distM ? +distM[1] : null;
  const wtM = q.match(/(\d+)\s*kg/); const wt = wtM ? +wtM[1] : null;
  const sevM = q.match(/(\d+)\s*%/); const sev = sevM ? +sevM[1]/100 : null;
  let region = null;
  for (const [c, r] of Object.entries(CHAT_REGIONS)) { if (q.includes(c)) { region = r; break; } }
  for (const r of ['north','south','east','west','central']) { if (q.includes(r)) { region = r; break; } }
  let weather = 'clear';
  for (const w of ['stormy','rainy','foggy','cold','storm','rain','fog']) { if (q.includes(w)) { weather = w.replace('rain','rainy').replace('storm','stormy').replace('fog','foggy'); break; } }

  if (/delay|risk|predict|will it be late/.test(q))
    return ['predict-delay', {delivery_partner:'delhivery',package_type:'electronics',vehicle_type:'truck',delivery_mode:'standard',region:region||'north',weather_condition:weather,distance_km:dist||500,package_weight_kg:wt||10}];
  if (/eta|how long|delivery time|estimated time/.test(q))
    return ['predict-eta', {distance_km:dist||50,hour:14,city:'Unknown',day_of_week:3}];
  if (/transport|cheapest|greenest|optimize|best mode|compare/.test(q)) {
    let priority = 'balanced';
    if (/green|eco/.test(q)) priority='green'; else if (/cheap|cost/.test(q)) priority='cost'; else if (/fast|speed/.test(q)) priority='speed';
    return ['optimize-transport', {distance_km:dist||1200,weight_kg:wt||300,deadline_hours:48,priority}];
  }
  if (/what if|what happens|disruption|simulate|strike|flood/.test(q)) {
    let dtype = 'weather';
    if (/port/.test(q)) dtype='port_congestion'; else if (/highway/.test(q)) dtype='highway_closure'; else if (/strike/.test(q)) dtype='strike';
    return ['whatif', {disruption_type:dtype,affected_region:region||'north',severity:sev||0.7,fleet_size:20,inject_region:true}];
  }
  if (/explain|why|reason|factor|shap/.test(q))
    return ['explain-delay', {delivery_partner:'delhivery',package_type:'electronics',vehicle_type:'truck',delivery_mode:'standard',region:region||'north',weather_condition:weather,distance_km:dist||1400,package_weight_kg:wt||25}];
  if (/anomal|scan|fleet|health|outlier/.test(q))
    return ['fleet-scan', null];
  if (/reroute|auto|fix|optimize fleet/.test(q))
    return ['auto-reroute', null];
  return [null, null];
}

function formatLocalChat(ep, r) {
  if (ep === 'predict-delay') {
    const p = r.delay_probability || r.probability || 0;
    const risk = r.risk_level || 'UNKNOWN';
    const icon = p > 0.6 ? '🔴' : p > 0.3 ? '🟡' : '🟢';
    return `<div style="font-weight:700;font-size:16px;margin-bottom:8px">${icon} ${risk} Risk — ${Math.round(p*100)}% delay probability</div>
      <div style="font-size:13px;color:var(--text-secondary)">${p>0.5?'⚠️ High chance of delay. Consider rerouting or switching to express.':'✅ Shipment looks on track.'}</div>`;
  }
  if (ep === 'predict-eta') {
    const eta = r.estimated_time_mins || 0;
    return `<div style="font-weight:700;font-size:16px">⏱️ ETA: ${Math.round(eta)} minutes (${(eta/60).toFixed(1)} hours)</div>`;
  }
  if (ep === 'optimize-transport') {
    const rec = r.recommended || {};
    const sav = r.savings || {};
    return `<div style="font-weight:700;font-size:16px;color:var(--green);margin-bottom:8px">✅ Best: ${rec.mode} — ₹${rec.total_cost_inr?.toLocaleString()} · ${rec.travel_time_hrs}h · ${rec.co2_emissions_kg}kg CO₂</div>
      <div style="font-size:13px">💰 Saves ₹${sav.cost_saving_inr||0} · 🌿 Saves ${sav.co2_saving_kg||0}kg CO₂</div>`;
  }
  if (ep === 'whatif') {
    const imp = r.impact_summary || {};
    return `<div style="font-weight:700;font-size:16px;margin-bottom:8px">💥 Disruption Impact</div>
      <div style="font-size:13px"><b>${imp.newly_at_risk||0}</b> shipments newly at risk · Penalty: <b>₹${(imp.estimated_penalty_inr||0).toLocaleString()}</b></div>`;
  }
  if (ep === 'explain-delay') {
    const p = r.probability || 0;
    let html = `<div style="font-weight:700;font-size:16px;margin-bottom:8px">${p>0.5?'🔴':'🟢'} ${r.prediction||'?'} — ${Math.round(p*100)}%</div>`;
    if (r.explanation) html += `<div style="font-size:13px;margin-bottom:10px">💡 ${r.explanation}</div>`;
    return html;
  }
  if (ep === 'fleet-scan') {
    const s = r.summary || {};
    return `<div style="font-weight:700;font-size:16px;margin-bottom:8px">🔍 Fleet Scan: ${s.total_shipments||0} shipments</div>
      <div style="font-size:13px">${s.anomalies_detected||0} anomalies · ${s.critical_alerts||0} critical · ${s.high_alerts||0} high</div>`;
  }
  if (ep === 'auto-reroute') {
    const rr = r.rerouted_shipments || [];
    return `<div style="font-weight:700;font-size:16px;color:var(--green);margin-bottom:8px">✅ Auto-rerouted ${rr.length} shipments</div>`;
  }
  return `<pre style="font-size:11px;overflow-x:auto">${JSON.stringify(r, null, 2).slice(0,500)}</pre>`;
}

function addChatMsg(role, html) {
  const el = document.getElementById('chatMessages');
  const empty = document.getElementById('chatEmpty');
  if (empty) empty.style.display = 'none';
  const bg = role === 'user' ? 'linear-gradient(135deg,var(--accent),#a29bfe)' : 'var(--bg-glass)';
  const align = role === 'user' ? 'margin-left:20%' : 'margin-right:20%';
  const label = role === 'user' ? '' : '<div style="font-size:10px;color:var(--accent);font-weight:600;margin-bottom:6px">LOGITRACK AI (Gemini + ML)</div>';
  el.innerHTML += `<div style="padding:12px 16px;border-radius:12px;margin-bottom:8px;background:${bg};border:1px solid var(--border);${align};font-size:13px">${label}${html}</div>`;
  el.scrollTop = el.scrollHeight;
}

async function sendChat() {
  const input = document.getElementById('chatInput');
  const q = input.value.trim();
  if (!q) return;
  input.value = '';
  addChatMsg('user', q);
  addChatMsg('ai', '<div class="spinner"></div> Analyzing with Gemini + ML engine...');

  // Try Gemini-powered /chat first, fall back to local parser
  try {
    const data = await mlPost('/ml/chat', { message: q });
    const msgs = document.getElementById('chatMessages');
    msgs.removeChild(msgs.lastChild);

    let html = '';
    if (data.tool_used) {
      html += `<div style="margin-bottom:8px"><span style="background:rgba(102,126,234,0.15);color:var(--accent);padding:2px 10px;border-radius:20px;font-size:11px;font-weight:600">🔧 ${data.tool_used}</span></div>`;
    }
    const response = (data.response || 'No response received.').replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html += `<div style="line-height:1.7">${response}</div>`;
    if (data.params_extracted && Object.keys(data.params_extracted).length > 0) {
      html += `<details style="margin-top:10px;font-size:11px;color:var(--text-secondary)"><summary style="cursor:pointer">View extracted parameters</summary><pre style="margin-top:6px;overflow-x:auto">${JSON.stringify(data.params_extracted, null, 2)}</pre></details>`;
    }
    addChatMsg('ai', html);
  } catch (geminiErr) {
    // Fallback: local parser + direct ML call
    const [ep, payload] = localParseChat(q);
    if (!ep) {
      const msgs = document.getElementById('chatMessages');
      msgs.removeChild(msgs.lastChild);
      addChatMsg('ai', '🤔 I didn\'t understand that. Try asking about <b>delay risk</b>, <b>transport modes</b>, <b>disruptions</b>, <b>anomalies</b>, <b>ETA</b>, or <b>explainability</b>.');
      return;
    }
    try {
      const isGet = ['fleet-scan','auto-reroute'].includes(ep);
      const data = isGet ? await mlGet(`/ml/${ep}`) : await mlPost(`/ml/${ep}`, payload);
      const msgs = document.getElementById('chatMessages');
      msgs.removeChild(msgs.lastChild);
      addChatMsg('ai', formatLocalChat(ep, data));
    } catch (e2) {
      const msgs = document.getElementById('chatMessages');
      msgs.removeChild(msgs.lastChild);
      addChatMsg('ai', `❌ ML engine error: ${e2.message}. It may be warming up — try again in 30s.`);
    }
  }
}

function askExample(q) { document.getElementById('chatInput').value = q; sendChat(); }
function clearChat() { const el = document.getElementById('chatMessages'); el.innerHTML = '<div class="empty-state" id="chatEmpty"><div class="empty-icon">💬</div><p>Ask me anything about your supply chain!</p></div>'; }

// ═══════ Init ═══════
loadDashboard();

