/**
 * Voice client for perception-voice service
 * Handles IPC with the perception-voice systemd daemon
 */

import { spawn } from 'child_process';

// Client UID for this mari instance (unique per process)
const CLIENT_UID = `mari_${process.pid}`;

// Polling interval for voice mode (ms)
const POLL_INTERVAL_MS = 200;

/**
 * Execute perception-voice client command
 * @param {string[]} args - Command arguments
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
async function execPerceptionVoice(args) {
  return new Promise((resolve) => {
    const proc = spawn('perception-voice', ['client', ...args], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    proc.on('close', (code) => {
      resolve({ code: code || 0, stdout, stderr });
    });
    
    proc.on('error', (err) => {
      resolve({ code: 1, stdout: '', stderr: err.message });
    });
    
    // Close stdin
    proc.stdin.end();
  });
}

/**
 * Set the read marker to current time
 * Call this when entering VOICE mode to start fresh
 * @returns {Promise<boolean>} True if successful
 */
export async function setVoiceMarker() {
  const result = await execPerceptionVoice(['set', CLIENT_UID]);
  return result.code === 0;
}

/**
 * Get transcriptions since the last marker
 * Returns array of { ts: string, text: string } objects
 * @returns {Promise<Array<{ts: string, text: string}>>}
 */
export async function getVoiceTranscriptions() {
  const result = await execPerceptionVoice(['get', CLIENT_UID]);
  
  if (result.code !== 0 || !result.stdout.trim()) {
    return [];
  }
  
  // Parse JSONL output
  const transcriptions = [];
  const lines = result.stdout.trim().split('\n');
  
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.text) {
        transcriptions.push(obj);
      }
    } catch (e) {
      // Skip malformed lines
    }
  }
  
  return transcriptions;
}

/**
 * Normalize text for voice pattern matching
 * Applies: trim, lowercase, alphanumeric only
 * @param {string} text - Raw transcription text
 * @returns {string} Normalized text
 */
export function normalizeVoiceText(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * VoiceListener class for continuous voice polling in VOICE mode
 */
export class VoiceListener {
  constructor() {
    this.polling = false;
    this.pollInterval = null;
    this.listeners = [];
  }
  
  /**
   * Start listening for voice transcriptions
   * Sets the marker and begins polling
   */
  async start() {
    if (this.polling) return;
    
    // Set marker to start fresh
    await setVoiceMarker();
    
    this.polling = true;
    this.pollInterval = setInterval(async () => {
      if (!this.polling) return;
      
      const transcriptions = await getVoiceTranscriptions();
      
      for (const t of transcriptions) {
        const normalized = normalizeVoiceText(t.text);
        if (normalized) {
          this._emit(normalized, t.text, t.ts);
        }
      }
    }, POLL_INTERVAL_MS);
  }
  
  /**
   * Stop listening for voice transcriptions
   */
  stop() {
    this.polling = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
  
  /**
   * Add listener for voice transcriptions
   * @param {function} fn - Listener (normalized, original, timestamp)
   */
  onVoice(fn) {
    this.listeners.push(fn);
  }
  
  /**
   * Remove listener
   * @param {function} fn - Listener to remove
   */
  offVoice(fn) {
    this.listeners = this.listeners.filter(l => l !== fn);
  }
  
  /**
   * Emit voice event to all listeners
   * @private
   */
  _emit(normalized, original, timestamp) {
    for (const fn of this.listeners) {
      fn(normalized, original, timestamp);
    }
  }
}
