'use client';

import { useEffect, useState } from 'react';

export default function SettingsPage() {
  const [config, setConfig] = useState({
    t4Weight: 0.5,
    t5Weight: 1.0,
    deadWeight: 5.0,
    kpPerPowerRatio: 0.3,
    deadPerPowerRatio: 0.02,
    discordWebhook: '',
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        if (!data.error) setConfig({
          t4Weight: data.t4Weight ?? 0.5,
          t5Weight: data.t5Weight ?? 1.0,
          deadWeight: data.deadWeight ?? 5.0,
          kpPerPowerRatio: data.kpPerPowerRatio ?? 0.3,
          deadPerPowerRatio: data.deadPerPowerRatio ?? 0.02,
          discordWebhook: data.discordWebhook ?? '',
        });
      });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (res.ok) {
        setMessage('Settings saved successfully!');
      } else {
        setMessage('Failed to save settings.');
      }
    } catch {
      setMessage('Network error.');
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(''), 3000);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setConfig(prev => ({ ...prev, [name]: name === 'discordWebhook' ? value : Number(value) }));
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>⚙️ Kingdom Settings</h1>
        <p>Configure advanced DKP formulas and webhook integrations.</p>
      </div>

      <div className="grid-2">
        <div className="card">
          <h2 className="mb-16">⚖️ Combat Weighting</h2>
          <p className="text-muted text-sm mb-16">Assign the DKP multipliers for each unit tied to your KvK tracking.</p>

          <div className="mb-16">
            <label className="form-label space-between">
              <span>T4 Kill Weight</span>
              <span className="text-gold">{config.t4Weight} DKP</span>
            </label>
            <input type="range" className="w-full" name="t4Weight" min="0" max="5" step="0.1" value={config.t4Weight} onChange={handleChange} />
          </div>

          <div className="mb-16">
            <label className="form-label space-between">
              <span>T5 Kill Weight</span>
              <span className="text-gold">{config.t5Weight} DKP</span>
            </label>
            <input type="range" className="w-full" name="t5Weight" min="0" max="10" step="0.5" value={config.t5Weight} onChange={handleChange} />
          </div>

          <div className="mb-16">
            <label className="form-label space-between">
              <span>Dead Troops Weight</span>
              <span className="text-gold">{config.deadWeight} DKP</span>
            </label>
            <input type="range" className="w-full" name="deadWeight" min="0" max="25" step="1" value={config.deadWeight} onChange={handleChange} />
          </div>
        </div>

        <div className="card">
          <h2 className="mb-16">📈 Power Expectations (Handicap)</h2>
          <p className="text-muted text-sm mb-16">Determine how many targeted points are expected per 1 Million Power.</p>

          <div className="mb-16">
            <label className="form-label space-between">
              <span>Expected KP per 1M Power</span>
              <span className="text-gold">{(config.kpPerPowerRatio * 1000).toLocaleString()}k</span>
            </label>
            <input type="range" className="w-full" name="kpPerPowerRatio" min="0" max="2" step="0.05" value={config.kpPerPowerRatio} onChange={handleChange} />
            <div className="text-muted text-sm mt-4">Example: 100M power requires {(config.kpPerPowerRatio * 100).toLocaleString()}M expected DKP.</div>
          </div>

          <div className="mb-16">
            <label className="form-label space-between">
              <span>Expected Deads per 1M Power</span>
              <span className="text-gold">{(config.deadPerPowerRatio * 1000).toLocaleString()}k</span>
            </label>
            <input type="range" className="w-full" name="deadPerPowerRatio" min="0" max="0.5" step="0.01" value={config.deadPerPowerRatio} onChange={handleChange} />
            <div className="text-muted text-sm mt-4">Example: 100M power requires {(config.deadPerPowerRatio * 100000).toLocaleString()} Deads.</div>
          </div>
        </div>
      </div>

      <div className="card mt-24">
        <h2 className="mb-16">🤖 Discord Integration</h2>
        <div className="mb-16">
          <label className="form-label">Webhook URL</label>
          <input
            type="text"
            className="form-input"
            name="discordWebhook"
            value={config.discordWebhook}
            onChange={handleChange}
            placeholder="https://discord.com/api/webhooks/..."
          />
        </div>
      </div>

      <div className="mt-24 flex items-center gap-16">
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : '💾 Save Settings'}
        </button>
        {message && <span className="text-gold animate-fade-in-up">{message}</span>}
      </div>
    </div>
  );
}
