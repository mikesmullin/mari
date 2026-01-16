/**
 * Jog wheel MIDI input handler
 * Reads from /dev/snd/midiC* devices
 */

import { readdir } from 'fs/promises';
import { openSync, readSync, closeSync } from 'fs';
import { join } from 'path';

/**
 * Find MIDI devices
 * @returns {Promise<string[]>} Array of device paths
 */
export async function listMidiDevices() {
  try {
    const entries = await readdir('/dev/snd');
    return entries
      .filter(name => name.startsWith('midiC'))
      .map(name => join('/dev/snd', name));
  } catch (err) {
    return [];
  }
}

/**
 * Parse MIDI CC message for jog wheel
 * @param {number} status - MIDI status byte
 * @param {number} controller - MIDI controller number
 * @param {number} value - MIDI value
 * @returns {'CW'|'CCW'|null} Direction or null
 */
export function parseJogWheel(status, controller, value) {
  // Check for Control Change message (0xB0)
  if ((status & 0xF0) !== 0xB0) return null;
  // Check for controller 0x0A (jog wheel)
  if (controller !== 0x0A) return null;
  
  // 0x01 = clockwise, other = counter-clockwise
  return value === 0x01 ? 'CW' : 'CCW';
}

/**
 * Jog wheel event handler class
 */
export class JogWheelHandler {
  constructor() {
    this.fd = null;
    this.polling = false;
    this.pollInterval = null;
    this.listeners = [];
    this.devicePath = null;
  }
  
  /**
   * Start listening for jog wheel events
   * @param {string} devicePath - MIDI device path (optional, auto-detect)
   * @returns {Promise<boolean>} True if started successfully
   */
  async start(devicePath = null) {
    if (this.polling) return true;
    
    try {
      // Find device
      if (!devicePath) {
        const devices = await listMidiDevices();
        if (devices.length === 0) {
          return false;
        }
        // Prefer midiC4 or last device
        devicePath = devices.find(d => d.includes('midiC4')) || devices[devices.length - 1];
      }
      
      this.devicePath = devicePath;
      this.fd = openSync(devicePath, 'r');
      this.polling = true;
      
      // Start polling
      const buffer = Buffer.alloc(3);
      this.pollInterval = setInterval(() => {
        try {
          const bytesRead = readSync(this.fd, buffer, 0, 3);
          if (bytesRead === 3) {
            const status = buffer[0];
            const controller = buffer[1];
            const value = buffer[2];
            
            const direction = parseJogWheel(status, controller, value);
            if (direction) {
              this._emit(direction);
            }
          }
        } catch (err) {
          // Ignore read errors (no data)
        }
      }, 10);
      
      return true;
    } catch (err) {
      return false;
    }
  }
  
  /**
   * Stop listening for jog wheel events
   */
  stop() {
    this.polling = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.fd !== null) {
      try {
        closeSync(this.fd);
      } catch (err) {
        // Ignore
      }
      this.fd = null;
    }
  }
  
  /**
   * Add jog wheel listener
   * @param {function} fn - Listener (receives 'CW' or 'CCW')
   */
  onJog(fn) {
    this.listeners.push(fn);
  }
  
  /**
   * Remove jog wheel listener
   * @param {function} fn - Listener to remove
   */
  offJog(fn) {
    this.listeners = this.listeners.filter(l => l !== fn);
  }
  
  /**
   * Emit jog event
   * @private
   */
  _emit(direction) {
    for (const fn of this.listeners) {
      fn(direction);
    }
  }
}
