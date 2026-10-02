const {
  getErrorMessage,
  getActiveImage,
  getSecondaryImage
} = require('../js/image-management.js');

describe('image management helpers', () => {
  test('formats legacy image management errors', () => {
    expect(getErrorMessage({ rc: 28 })).toBe('An image is already pending');
  });

  test('formats SMP v2 errors with their management group', () => {
    expect(getErrorMessage({ err: { group: 1, rc: 8 } })).toBe('Image hash not found (SMP group 1)');
  });

  test('returns no error for success or responses without an error code', () => {
    expect(getErrorMessage({ rc: 0 })).toBeNull();
    expect(getErrorMessage({ images: [] })).toBeNull();
  });

  test('uses a metadata-marked active image independent of array order', () => {
    const active = { slot: 1, active: true };
    expect(getActiveImage([{ slot: 0, active: false }, active])).toBe(active);
  });

  test('prefers an inactive secondary slot independent of array order', () => {
    const secondary = { slot: 1, active: false };
    expect(getSecondaryImage([{ slot: 0, active: true }, secondary])).toBe(secondary);
  });

  test('does not select the active image as the secondary image', () => {
    const active = { slot: 1, active: true };
    const secondary = { slot: 0, active: false };
    expect(getSecondaryImage([active, secondary])).toBe(secondary);
  });
});