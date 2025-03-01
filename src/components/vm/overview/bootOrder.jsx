/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */
import React, { useState } from 'react';
import PropTypes from 'prop-types';
import cockpit from 'cockpit';

import {
    Button,
    DataList,
    DataListAction,
    DataListCell,
    DataListCheck,
    DataListControl,
    DataListItem,
    DataListItemCells,
    DataListItemRow,
    Flex,
    FlexItem,
    DescriptionList,
    DescriptionListDescription,
    DescriptionListGroup,
    DescriptionListTerm,
    Modal,
    Tooltip,
} from '@patternfly/react-core';

import {
    AngleDownIcon,
    AngleUpIcon
} from '@patternfly/react-icons';

import { ModalError } from 'cockpit-components-inline-notification.jsx';
import {
    findHostNodeDevice,
    getSortedBootOrderDevices,
    rephraseUI,
    vmId
} from '../../../helpers.js';
import { domainGet, domainChangeBootOrder } from '../../../libvirtApi/domain.js';

import './bootOrder.css';

const _ = cockpit.gettext;

/**
 * Return an array of devices, which can assigned boot order, with added properties needed for UI.
 *
 * @param {object} vm
 * @returns {array}
 */
function getUIBootOrderDevices(vm) {
    const devices = getSortedBootOrderDevices(vm.inactiveXML);

    devices.forEach(dev => {
        dev.checked = typeof dev.bootOrder !== 'undefined';
        dev.initialOrder = parseInt(dev.bootOrder);
    });

    return devices;
}

const DeviceInfo = ({ descr, value }) => {
    return (
        <DescriptionListGroup>
            <DescriptionListTerm>
                {descr}
            </DescriptionListTerm>
            <DescriptionListDescription id={value}>
                {value}
            </DescriptionListDescription>
        </DescriptionListGroup>
    );
};

const DeviceRow = ({ idPrefix, device, index, onToggle, upDisabled, downDisabled, moveUp, moveDown, nodeDevices }) => {
    let heading;
    const additionalInfo = [];

    const addOptional = (additionalInfo, value, descr) => {
        if (value) {
            additionalInfo.push(
                <DeviceInfo descr={descr} value={value} key={index + descr} />
            );
        }
    };

    switch (device.type) {
    case "disk": {
        heading = rephraseUI("bootableDisk", "disk");
        addOptional(additionalInfo, device.device.source.file, _("File"));
        addOptional(additionalInfo, device.device.source.dev, _("Device"));
        addOptional(additionalInfo, device.device.source.protocol, _("Protocol"));
        addOptional(additionalInfo, device.device.source.pool, _("Pool"));
        addOptional(additionalInfo, device.device.source.volume, _("Volume"));
        addOptional(additionalInfo, device.device.source.host.name, _("Host"));
        addOptional(additionalInfo, device.device.source.host.port, _("Port"));
        if (device.device.device === "cdrom") {
            addOptional(additionalInfo, device.device.device, _("Device"));
            addOptional(additionalInfo, device.device.bus, _("Bus"));
        }
        break;
    }
    case "network": {
        heading = rephraseUI("bootableDisk", "network");
        addOptional(additionalInfo, device.device.mac, _("MAC"));
        break;
    }
    case "redirdev": {
        heading = rephraseUI("bootableDisk", "redirdev");
        addOptional(additionalInfo, device.device.type, _("Type"));
        addOptional(additionalInfo, device.device.bus, _("Bus"));
        addOptional(additionalInfo, device.device.address.port, _("Port"));
        break;
    }
    case "hostdev": {
        heading = rephraseUI("bootableDisk", "hostdev");
        const nodeDev = findHostNodeDevice(device.device, nodeDevices);
        if (nodeDev) {
            switch (device.device.type) {
            case "usb": {
                addOptional(additionalInfo, device.device.type, _("Type"));
                addOptional(additionalInfo, nodeDev.capability.vendor._value, _("Vendor"));
                addOptional(additionalInfo, nodeDev.capability.product._value, _("Product"));
                break;
            }
            case "pci": {
                addOptional(additionalInfo, device.device.type, _("Type"));
                addOptional(additionalInfo, nodeDev.capability.vendor._value, _("Vendor"));
                addOptional(additionalInfo, nodeDev.capability.product._value, _("Product"));
                addOptional(additionalInfo, nodeDev.capability.bus, _("Bus"));
                addOptional(additionalInfo, nodeDev.capability.domain, _("Domain"));
                addOptional(additionalInfo, nodeDev.capability.function, _("Function"));
                addOptional(additionalInfo, nodeDev.capability.slot, _("Slot"));
                break;
            }
            case "scsi": {
                addOptional(additionalInfo, device.device.type, _("Type"));
                addOptional(additionalInfo, device.device.source.address.bus, _("Bus"));
                addOptional(additionalInfo, device.device.source.address.target, _("Target"));
                addOptional(additionalInfo, device.device.source.address.unit, _("Unit"));
                break;
            }
            case "scsi_host": {
                addOptional(additionalInfo, device.device.type, _("Type"));
                addOptional(additionalInfo, device.device.source.protocol, _("Protocol"));
                addOptional(additionalInfo, device.device.source.wwpn, _("WWPN"));
                break;
            }
            case "mdev": {
                addOptional(additionalInfo, device.device.type, _("Type"));
                addOptional(additionalInfo, nodeDev.capability.type.id, _("Type ID"));
                break;
            }
            }
        }
        break;
    }
    }

    const upArrow = <Button isSmall isDisabled={upDisabled} onClick={moveUp} icon={<AngleUpIcon />} id={`${idPrefix}-up`} />;
    const downArrow = <Button isSmall isDisabled={downDisabled} onClick={moveDown} icon={<AngleDownIcon />} id={`${idPrefix}-down`} />;

    return (
        <DataListItem
            id={`${idPrefix}-device-row-${index}`}
            className={ device.checked ? "is-checked" : "" }
        >
            <DataListItemRow>
                <DataListControl>
                    <DataListCheck id={`${idPrefix}-device-${index}-checkbox`}
                                       name={`${idPrefix}-device-${index}-checkbox`}
                                       otherControls
                                       onChange={onToggle}
                                       isChecked={!!device.checked} />
                </DataListControl>
                <DataListItemCells dataListCells={[
                    <DataListCell className="boot-order-modal-cell" key="item1">
                        <span className="boot-order-description">{heading}</span>
                        <span className="boot-order-additional-info">
                            <DescriptionList isHorizontal>{additionalInfo}</DescriptionList>
                        </span>
                    </DataListCell>
                ]} />
                <DataListAction>
                    {upArrow}
                </DataListAction>
                <DataListAction>
                    {downArrow}
                </DataListAction>
            </DataListItemRow>
        </DataListItem>
    );
};

class BootOrderModal extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            devices: getUIBootOrderDevices(props.vm),
        };
        this.dialogErrorSet = this.dialogErrorSet.bind(this);
        this.close = props.close;
        this.save = this.save.bind(this);
        this.onToggleDevice = this.onToggleDevice.bind(this);
        this.moveUp = this.moveUp.bind(this);
        this.moveDown = this.moveDown.bind(this);
    }

    dialogErrorSet(text, detail) {
        this.setState({ dialogError: text, dialogErrorDetail: detail });
    }

    save() {
        const { vm } = this.props;
        const devices = this.state.devices.filter((device) => device.checked);

        domainChangeBootOrder({
            id: vm.id,
            connectionName: vm.connectionName,
            devices,
        })
                .then(() => {
                    domainGet({ connectionName: vm.connectionName, id: vm.id });
                    this.close();
                })
                .catch(exc => this.dialogErrorSet(_("Boot order settings could not be saved"), exc.message));
    }

    onToggleDevice(device) {
        // create new array so we don't edit state
        const devices = [...this.state.devices];

        devices[devices.indexOf(device)].checked = !devices[devices.indexOf(device)].checked;

        this.setState({ devices: devices });
    }

    moveUp(device) {
        const direction = -1;
        // create new array so we don't edit state
        const devices = [...this.state.devices];

        const index = devices.indexOf(device);
        const tmp = devices[index + direction];
        devices[index + direction] = devices[index];
        devices[index] = tmp;

        this.setState({ devices: devices });
    }

    moveDown(device) {
        const direction = 1;
        // create new array so we don't edit state
        const devices = [...this.state.devices];

        const index = devices.indexOf(device);
        const tmp = devices[index + direction];
        devices[index + direction] = devices[index];
        devices[index] = tmp;

        this.setState({ devices: devices });
    }

    render() {
        const { nodeDevices, vm } = this.props;
        const idPrefix = vmId(vm.name) + '-order-modal';
        const defaultBody = (
            <DataList isCompact
                          className="boot-order-list-view">
                {this.state.devices.map((device, index) => {
                    const nextDevice = this.state.devices[index + 1];
                    return <DeviceRow
                                    key={index}
                                    idPrefix={idPrefix}
                                    index={index}
                                    device={device}
                                    onClick={() => this.onToggleDevice(device)}
                                    onToggle={() => this.onToggleDevice(device)}
                                    upDisabled={!index || !device.checked}
                                    downDisabled={index + 1 == this.state.devices.length || !nextDevice.checked}
                                    moveUp={() => this.moveUp(device)}
                                    moveDown={() => this.moveDown(device)}
                                    nodeDevices={nodeDevices}
                    />;
                })}
            </DataList>
        );

        return (
            <Modal position="top" variant="medium" id={`${idPrefix}-window`} isOpen onClose={this.close} className='boot-order'
                   title={_("Change boot order")}
                   footer={
                       <>
                           {this.state.dialogError && <ModalError dialogError={this.state.dialogError} dialogErrorDetail={this.state.dialogErrorDetail} />}
                           <Button id={`${idPrefix}-save`} variant='primary' onClick={this.save}>
                               {_("Save")}
                           </Button>
                           <Button id={`${idPrefix}-cancel`} variant='link' onClick={this.close}>
                               {_("Cancel")}
                           </Button>
                       </>
                   }>
                <>
                    {defaultBody}
                </>
            </Modal>
        );
    }
}

BootOrderModal.propTypes = {
    close: PropTypes.func.isRequired,
    vm: PropTypes.object.isRequired,
    nodeDevices: PropTypes.array.isRequired,
};

/**
 * Returns a sorted array of all devices with boot order
 *
 * @param {object} vm
 * @returns {array}
 */
function getBootOrder(vm) {
    let bootOrder = _("No boot device found");
    const devices = getSortedBootOrderDevices(vm).filter(d => d.bootOrder);

    if (devices && devices.length > 0) {
        bootOrder = devices.map(bootDevice => rephraseUI("bootableDisk", bootDevice.type)).join(); // Example: network,disk,disk
    }

    return bootOrder;
}

export const BootOrderLink = ({ vm, idPrefix, close, nodeDevices }) => {
    const [bootOrderShow, setBootOrderShow] = useState(false);
    const modalButton = (
        <Button variant="link" isInline isAriaDisabled={vm.state != 'shut off'} onClick={setBootOrderShow}>
            {_("edit")}
        </Button>
    );

    return (
        <Flex spaceItems={{ default: 'spaceItemsSm' }}>
            {bootOrderShow && <BootOrderModal close={() => setBootOrderShow(false)} vm={vm} nodeDevices={nodeDevices} />}
            <FlexItem>{getBootOrder(vm)}</FlexItem>
            {vm.state == 'shut off' ? modalButton : <Tooltip content={_("Only editable when the guest is shut off")}>{modalButton}</Tooltip>}
        </Flex>
    );
};
