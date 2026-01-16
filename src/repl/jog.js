/**
 * Jog wheel MIDI input handler
 * Reads from /dev/snd/midiC* devices using non-blocking I/O
 */

import { readdir } from 'fs/promises';
import { open as openCb, read as readCb, close as closeCb, constants } from 'fs';
import { join } from 'path';
import { promisify } from 'util';

const openAsync = promisify(openCb);
const closeAsync = promisify(closeCb);

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
      
      // Open with O_RDONLY | O_NONBLOCK for non-blocking reads
      this.fd = await openAsync(devicePath, constants.O_RDONLY | constants.O_NONBLOCK);
      this.polling = true;
      
      // Start polling with non-blocking reads
      const buffer = Buffer.alloc(3);
      
      const pollFn = () => {
        if (!this.polling || this.fd === null) return;
        
        // Use callback-based read for non-blocking behavior
        readCb(this.fd, buffer, 0, 3, null, (err, bytesRead) => {
          if (!err && bytesRead === 3) {
            const direction = parseJogWheel(buffer[0], buffer[1], buffer[2]);
            if (direction) {
              this._emit(direction);
            }
          }
          // EAGAIN means no data available - that's fine
          
          if (this.polling) {
            setTimeout(pollFn, 5);
          }
        });
      };
      
      // Start polling in background
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
    if (this.fd !== null) {
      try {
        await closeAsync(this.fd);
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
