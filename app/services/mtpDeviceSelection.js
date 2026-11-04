// Selection is requested before opening an MTP session.
let pending = null;

export const chooseMtpDevice = (devices) => {
  if (pending) return pending;
  pending = new Promise((resolve) => {
    window.dispatchEvent(
      new CustomEvent('mtp-device-choice', {
        detail: {
          devices,
          finish: (key) => {
            pending = null;
            resolve(key);
          },
        },
      })
    );
  });

  return pending;
};
