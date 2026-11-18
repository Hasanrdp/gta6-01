// Input: keyboard state plus edge-triggered actions. The game reads the held
// keys every fixed step; actions (confirm, pause, interact, radio, punch,
// shoot) fire once per press. Mouse drag orbits the camera a little; a click
// is also "confirm" on menus and "shoot" while playing.
export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_INTERACT = 4;
export const ACTION_RADIO = 8;
export const ACTION_PUNCH = 16;
export const ACTION_SHOOT = 32;
export const ACTION_MUTE = 64;

export function createInput(canvas, onFirstGesture) {
  const keys = new Set();
  let actions = 0;
  let camYaw = 0;
  let clicked = false;
  let dragging = false;
  let lastX = 0;
  let gestured = false;

  function gesture() {
    if (!gestured) {
      gestured = true;
      if (onFirstGesture) onFirstGesture();
    }
  }

  const KEY_ACTIONS = {
    Space: ACTION_CONFIRM,
    Enter: ACTION_CONFIRM,
    KeyP: ACTION_PAUSE,
    Escape: ACTION_PAUSE,
    KeyE: ACTION_INTERACT,
    KeyR: ACTION_RADIO,
    KeyF: ACTION_PUNCH,
    KeyM: ACTION_MUTE,
  };

  window.addEventListener('keydown', (e) => {
    gesture();
    if (e.repeat) return;
    keys.add(e.code);
    const a = KEY_ACTIONS[e.code];
    if (a !== undefined) actions |= a;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  canvas.addEventListener('mousedown', (e) => {
    gesture();
    dragging = true;
    lastX = e.clientX;
    clicked = true;
    actions |= ACTION_CONFIRM;
  });
  window.addEventListener('mouseup', () => { dragging = false; });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    camYaw += (e.clientX - lastX) * 0.004;
    lastX = e.clientX;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    /** Held movement: x = strafe/right, y = forward, in camera space. */
    move() {
      let x = 0;
      let y = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) y += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) y -= 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
      return { x, y };
    },
    sprint() {
      return keys.has('ShiftLeft') || keys.has('ShiftRight');
    },
    handbrake() {
      return keys.has('Space');
    },
    takeActions() {
      const a = actions;
      actions = 0;
      return a;
    },
    takeCamYaw() {
      const y = camYaw;
      camYaw = 0;
      return y;
    },
    /** True once per canvas click (shooting while playing). */
    takeClick() {
      const c = clicked;
      clicked = false;
      return c;
    },
  };
}
