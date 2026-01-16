/**
 * Jog wheel MIDI input handler
 * Reads from /dev/snd/midiC* devices
 */

import { readdir } from 'fs/promises';
import { open } from 'fs/promises';
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
    this.fileHandle = null;
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
      
      // Open file with non-blocking flag
      this.fileHandle = await open(devicePath, 'r');
      this.polling = true;
      
      // Start polling with async reads
      const buffer = Buffer.alloc(3);
      
      const pollFn = async () => {
        if (!this.polling || !this.fileHandle) return;
        
        try {
          const { bytesRead } = await this.fileHandle.read(buffer, 0, 3);
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
          // Ignore read errors
        }
        
        if (this.polling) {
          setTimeout(pollFn, 10);
        }
      };
      
      // Don't block startup - start polling in background
      setTimeout(pollFn, 100);
      
      return true;
    } catch (err) {
      return false;
    }
  }
  
  /**
   * Stop listening for jog wheel events
   */
  async stop() {
    this.polling = false;
    if (this.fileHandle) {
      try {
        await this.fileHandle.close();
      } catch (err) {
        // Ignore
      }
      this.fileHandle = null;
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
