(function (root, factory) {
    const imageManagement = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = imageManagement;
    } else {
        root.McumgrImageManagement = imageManagement;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const errorMessages = {
        0: 'Success',
        1: 'Unknown image-management error',
        2: 'Failed to query flash configuration',
        3: 'No image in requested slot',
        4: 'Image has no TLVs',
        5: 'Invalid image TLV',
        6: 'Multiple hash TLVs found',
        7: 'Invalid TLV size',
        8: 'Image hash not found',
        9: 'No free slot available',
        10: 'Flash open failed',
        11: 'Flash read failed',
        12: 'Flash write failed',
        13: 'Flash erase failed',
        14: 'Invalid slot',
        15: 'Out of memory',
        16: 'Flash context already set',
        17: 'Flash context not set',
        18: 'Flash device is null',
        19: 'Invalid page offset',
        20: 'Invalid offset',
        21: 'Invalid length',
        22: 'Invalid image header',
        23: 'Invalid image header magic',
        24: 'Invalid hash',
        25: 'Invalid flash address',
        26: 'Failed to get running image version',
        27: 'Current version is newer than upload',
        28: 'An image is already pending',
        29: 'Invalid image vector table',
        30: 'Image is too large',
        31: 'Image data overrun',
        32: 'Image confirmation denied',
        33: 'Cannot test active slot; slot 1 may match the running image',
        34: 'Active slot could not be determined'
    };

    function getErrorMessage(data) {
        if (!data || typeof data !== 'object') return null;
        const error = data.err && typeof data.err === 'object' ? data.err : data;
        if (typeof error.rc !== 'number' || error.rc === 0) return null;

        const message = errorMessages[error.rc] || `Image management error code ${error.rc}`;
        return typeof error.group === 'number' ? `${message} (SMP group ${error.group})` : message;
    }

    function getActiveImage(images) {
        const imageList = Array.isArray(images) ? images : [];
        return imageList.find(image => image && image.active === true)
            || imageList.find(image => image && image.slot === 0)
            || imageList[0];
    }

    function getSecondaryImage(images) {
        const imageList = Array.isArray(images) ? images : [];
        const inactiveImage = imageList.find(image => image && image.active === false && image.slot === 1)
            || imageList.find(image => image && image.active === false);
        if (inactiveImage) return inactiveImage;

        return imageList.find(image => image && image.slot === 1) || imageList[1];
    }

    return { getErrorMessage, getActiveImage, getSecondaryImage };
});