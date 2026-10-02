import manager from './mcumgr.js';
import CBOR from './cbor.js';
import SMP from './protocol/smp.js';
import baseTransport from './transports/base.js';
import serialFraming from './transports/serial-framing.js';
import imageManagement from './image-management.js';

export const {
    MCUManager,
    SMP_VERSION_1,
    SMP_VERSION_2,
    MCUTransportBluetooth,
    MCUTransportSerial,
    MGMT_OP_READ,
    MGMT_OP_READ_RSP,
    MGMT_OP_WRITE,
    MGMT_OP_WRITE_RSP,
    MGMT_GROUP_ID_OS,
    MGMT_GROUP_ID_IMAGE,
    MGMT_GROUP_ID_STAT,
    MGMT_GROUP_ID_CONFIG,
    MGMT_GROUP_ID_LOG,
    MGMT_GROUP_ID_CRASH,
    MGMT_GROUP_ID_SPLIT,
    MGMT_GROUP_ID_RUN,
    MGMT_GROUP_ID_FS,
    MGMT_GROUP_ID_SHELL,
    MGMT_GROUP_ID_ENUM,
    ENUM_MGMT_ID_COUNT,
    ENUM_MGMT_ID_LIST,
    ENUM_MGMT_ID_SINGLE,
    ENUM_MGMT_ID_DETAILS,
    SHELL_MGMT_ID_EXEC,
    OS_MGMT_ID_ECHO,
    OS_MGMT_ID_CONS_ECHO_CTRL,
    OS_MGMT_ID_TASKSTAT,
    OS_MGMT_ID_MPSTAT,
    OS_MGMT_ID_DATETIME_STR,
    OS_MGMT_ID_RESET,
    IMG_MGMT_ID_STATE,
    IMG_MGMT_ID_UPLOAD,
    IMG_MGMT_ID_FILE,
    IMG_MGMT_ID_CORELIST,
    IMG_MGMT_ID_CORELOAD,
    IMG_MGMT_ID_ERASE
} = manager;

export const MCUTransport = baseTransport.MCUTransport;
export const SerialFraming = serialFraming;
export const ImageManagement = imageManagement;
export { CBOR, SMP };
export default MCUManager;