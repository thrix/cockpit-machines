/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2018 Red Hat, Inc.
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
import React from 'react';
import {
    Alert, Bullseye, Button, Checkbox,
    ExpandableSection, Form, FormGroup,
    FormSelect, FormSelectOption,
    Grid,
    Modal, Radio, Spinner,
} from '@patternfly/react-core';
import cockpit from 'cockpit';

import { FileAutoComplete } from 'cockpit-components-file-autocomplete.jsx';
import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { diskBusTypes, diskCacheModes, units, convertToUnit, getDefaultVolumeFormat, getNextAvailableTarget, getStorageVolumesUsage, getStorageVolumeDiskTarget } from '../../../helpers.js';
import { VolumeCreateBody } from '../../storagePools/storageVolumeCreateBody.jsx';
import { domainAttachDisk, domainGet, domainIsRunning, domainUpdateDiskAttributes } from '../../../libvirtApi/domain.js';
import { storagePoolGetAll } from '../../../libvirtApi/storagePool.js';
import { storageVolumeCreateAndAttach } from '../../../libvirtApi/storageVolume.js';

const _ = cockpit.gettext;

const CREATE_NEW = 'create-new';
const USE_EXISTING = 'use-existing';
const CUSTOM_PATH = 'custom-path';

const poolTypesNotSupportingVolumeCreation = ['iscsi', 'iscsi-direct', 'gluster', 'mpath'];

function getFilteredVolumes(vmStoragePool, disks) {
    const usedDiskPaths = Object.getOwnPropertyNames(disks)
            .filter(target => disks[target].source && (disks[target].source.file || disks[target].source.volume))
            .map(target => (disks[target].source && (disks[target].source.file || disks[target].source.volume)));

    const filteredVolumes = vmStoragePool.volumes.filter(volume => !usedDiskPaths.includes(volume.path) && !usedDiskPaths.includes(volume.name));

    const filteredVolumesSorted = filteredVolumes.sort(function(a, b) {
        return a.name.localeCompare(b.name);
    });

    return filteredVolumesSorted;
}

const SelectExistingVolume = ({ idPrefix, storagePoolName, existingVolumeName, onValueChanged, vmStoragePools, vmDisks }) => {
    const vmStoragePool = vmStoragePools.find(pool => pool.name == storagePoolName);
    const filteredVolumes = getFilteredVolumes(vmStoragePool, vmDisks);

    let initiallySelected;
    let content;
    if (filteredVolumes.length > 0) {
        content = filteredVolumes.map(volume => {
            return (
                <FormSelectOption value={volume.name} key={volume.name}
                                  label={volume.name} />
            );
        });
        initiallySelected = existingVolumeName;
    } else {
        content = (
            <FormSelectOption value="empty" key="empty-list"
                              label={_("The pool is empty")} />
        );
        initiallySelected = "empty";
    }

    return (
        <FormGroup fieldId={`${idPrefix}-select-volume`} label={_("Volume")}>
            <FormSelect id={`${idPrefix}-select-volume`}
                        onChange={value => onValueChanged('existingVolumeName', value)}
                        value={initiallySelected}
                        isDisabled={!filteredVolumes.length}>
                {content}
            </FormSelect>
        </FormGroup>
    );
};

const PermanentChange = ({ idPrefix, onValueChanged, permanent, vm }) => {
    // By default for a running VM, the disk is attached until shut down only. Enable permanent change of the domain.xml
    if (!domainIsRunning(vm.state)) {
        return null;
    }

    return (
        <FormGroup fieldId={`${idPrefix}-permanent`} label={_("Persistence")} hasNoPaddingTop>
            <Checkbox id={`${idPrefix}-permanent`}
                      isChecked={permanent}
                      label={_("Always attach")}
                      onChange={checked => onValueChanged('permanent', checked)} />
        </FormGroup>
    );
};

const PoolRow = ({ idPrefix, onValueChanged, storagePoolName, validationFailed, vmStoragePools }) => {
    const validationStatePool = validationFailed.storagePool ? 'error' : 'default';

    return (
        <FormGroup fieldId={`${idPrefix}-select-pool`}
                   helperTextInvalid={validationFailed.storagePool}
                   validated={validationStatePool}
                   label={_("Pool")}>
            <FormSelect id={`${idPrefix}-select-pool`}
                           isDisabled={!vmStoragePools.length || !vmStoragePools.every(pool => pool.volumes !== undefined)}
                           onChange={value => onValueChanged('storagePoolName', value)}
                           validated={validationStatePool}
                           value={storagePoolName || 'no-resource'}>
                {vmStoragePools.length > 0 ? vmStoragePools
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map(pool => {
                            return (
                                <FormSelectOption isDisabled={pool.disabled} value={pool.name} key={pool.name}
                                                  label={pool.name} />
                            );
                        })
                    : [<FormSelectOption value='no-resource' key='no-resource'
                                         label={_("No storage pools available")} />]}
            </FormSelect>
        </FormGroup>
    );
};

class AdditionalOptions extends React.Component {
    constructor(props) {
        super(props);
        this.state = { expanded: false };
    }

    render() {
        const displayBusTypes = diskBusTypes[this.props.device]
                .filter(bus => this.props.supportedDiskBusTypes.includes(bus))
                .map(type => ({ value: type }));
        if (displayBusTypes.find(busType => busType.value == this.props.busType) == undefined)
            displayBusTypes.push({ value: this.props.busType, disabled: true });

        return (
            <ExpandableSection toggleText={ this.state.expanded ? _("Hide additional options") : _("Show additional options")}
                               onToggle={() => this.setState({ expanded: !this.state.expanded })} isExpanded={this.state.expanded} className="add-disk-additional-options">
                <Grid hasGutter md={6}>
                    <FormGroup fieldId='cache-mode' label={_("Cache")}>
                        <FormSelect id='cache-mode'
                            onChange={value => this.props.onValueChanged('cacheMode', value)}
                            value={this.props.cacheMode}>
                            {diskCacheModes.map(cacheMode => {
                                return (
                                    <FormSelectOption value={cacheMode} key={cacheMode}
                                                      label={cacheMode} />
                                );
                            })}
                        </FormSelect>
                    </FormGroup>

                    <FormGroup fieldId={this.props.idPrefix + '-bus-type'} label={_("Bus")}>
                        <FormSelect id={this.props.idPrefix + '-bus-type'}
                            data-value={this.props.busType}
                            onChange={value => this.props.onValueChanged('busType', value)}
                            value={this.props.busType}>
                            {displayBusTypes.map(busType => {
                                return (
                                    <FormSelectOption value={busType.value}
                                                      key={busType.value}
                                                      isDisabled={busType.disabled}
                                                      label={busType.value} />
                                );
                            })}
                        </FormSelect>
                    </FormGroup>
                </Grid>
            </ExpandableSection>
        );
    }
}

const CreateNewDisk = ({
    format,
    idPrefix,
    onValueChanged,
    size,
    storagePoolName,
    unit,
    validationFailed,
    vm,
    vmStoragePools,
    volumeName,
}) => {
    const storagePool = vmStoragePools.find(pool => pool.name == storagePoolName);

    return (
        <>
            <PoolRow idPrefix={idPrefix}
                     storagePoolName={storagePoolName}
                     validationFailed={validationFailed}
                     onValueChanged={onValueChanged}
                     vmStoragePools={vmStoragePools.map(pool => ({ ...pool, disabled: poolTypesNotSupportingVolumeCreation.includes(pool.type) }))} />
            {storagePool &&
            <VolumeCreateBody format={format}
                              size={size}
                              storagePool={storagePool}
                              unit={unit}
                              validationFailed={validationFailed}
                              volumeName={volumeName}
                              idPrefix={idPrefix}
                              onValueChanged={onValueChanged} />}
        </>
    );
};

const ChangeShareable = ({ idPrefix, vms, storagePool, volumeName, onValueChanged }) => {
    const isVolumeUsed = getStorageVolumesUsage(vms, storagePool);
    const volume = storagePool.volumes.find(vol => vol.name === volumeName);

    if (!isVolumeUsed[volumeName] || (isVolumeUsed[volumeName].length === 0))
        return null;

    const vmsUsing = isVolumeUsed[volumeName].join(', ') + '.';
    let text = _("This volume is already used by: ") + vmsUsing;
    if (volume.format === "raw")
        text += _("Attaching it will make this disk shareable for every VM using it.");

    return <Alert isInline variant='warning' id={`${idPrefix}-vms-usage`} title={text} />;
};

const UseExistingDisk = ({
    existingVolumeName,
    idPrefix,
    onValueChanged,
    storagePoolName,
    validationFailed,
    vm,
    vmStoragePools,
    vms,
}) => {
    return (
        <>
            <PoolRow idPrefix={idPrefix}
                     storagePoolName={storagePoolName}
                     validationFailed={validationFailed}
                     onValueChanged={onValueChanged}
                     vmStoragePools={vmStoragePools} />
            {vmStoragePools.length > 0 && <>
                <SelectExistingVolume idPrefix={idPrefix}
                                      storagePoolName={storagePoolName}
                                      existingVolumeName={existingVolumeName}
                                      onValueChanged={onValueChanged}
                                      vmStoragePools={vmStoragePools}
                                      vmDisks={vm.disks} />
                <ChangeShareable idPrefix={idPrefix}
                                 vms={vms}
                                 storagePool={vmStoragePools.find(pool => pool.name === storagePoolName)}
                                 volumeName={existingVolumeName}
                                 onValueChanged={onValueChanged} />
            </>}
        </>
    );
};

const CustomPath = ({ idPrefix, onValueChanged, device }) => {
    return (<>
        <FormGroup id={`${idPrefix}-file`}
                   fieldId={`${idPrefix}-file-autocomplete`}
                   label={_("Custom path")}>
            <FileAutoComplete id={`${idPrefix}-file-autocomplete`}
                placeholder={_("Path to file on host's file system")}
                onChange={value => onValueChanged("file", value)}
                superuser="try" />
        </FormGroup>
        <FormGroup id={`${idPrefix}-device`}
                   fieldId={`${idPrefix}-select-device`}
                   label={_("Device")}>
            <FormSelect id={`${idPrefix}-select-device`}
                        onChange={value => onValueChanged('device', value)}
                        value={device}>
                <FormSelectOption value="disk" key="disk"
                                  label={_("Disk image file")} />
                <FormSelectOption value="cdrom" key="cdrom"
                                  label={_("CD/DVD disc")} />
            </FormSelect>
        </FormGroup>
    </>);
};

export class AddDiskModalBody extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            validate: false,
            dialogLoading: true
        };
        this.onValueChanged = this.onValueChanged.bind(this);
        this.dialogErrorSet = this.dialogErrorSet.bind(this);
        this.onAddClicked = this.onAddClicked.bind(this);
        this.getDefaultVolumeName = this.getDefaultVolumeName.bind(this);
        this.existingVolumeNameDelta = this.existingVolumeNameDelta.bind(this);
        this.validateParams = this.validateParams.bind(this);
    }

    get initialState() {
        const { vm, storagePools, vms } = this.props;
        const defaultBus = 'virtio';
        const existingTargets = Object.getOwnPropertyNames(vm.disks);
        const availableTarget = getNextAvailableTarget(existingTargets, defaultBus);
        const sortFunction = (poolA, poolB) => poolA.name.localeCompare(poolB.name);
        let defaultPool;
        if (storagePools.length > 0)
            defaultPool = storagePools
                    .map(pool => ({ name: pool.name, type: pool.type }))
                    .sort(sortFunction)[0];

        return {
            storagePools,
            vm, vms,
            file: "",
            device: "disk",
            storagePoolName: defaultPool && defaultPool.name,
            storagePoolType: defaultPool && defaultPool.type,
            mode: CREATE_NEW,
            volumeName: undefined,
            existingVolumeName: undefined,
            size: 1,
            unit: units.GiB.name,
            format: defaultPool && getDefaultVolumeFormat(defaultPool),
            target: availableTarget,
            permanent: !domainIsRunning(vm.state), // default true for a down VM; for a running domain, the disk is attached tentatively only
            hotplug: domainIsRunning(vm.state), // must be kept false for a down VM; the value is not being changed by user
            addDiskInProgress: false,
            cacheMode: 'default',
            busType: defaultBus,
            updateDisks: false,
        };
    }

    componentDidMount() {
        // Refresh storage volume list before displaying the dialog.
        // There are recently no Libvirt events for storage volumes and polling is ugly.
        // https://bugzilla.redhat.com/show_bug.cgi?id=1578836
        storagePoolGetAll({ connectionName: this.props.vm.connectionName })
                .then(() => this.setState({ dialogLoading: false, ...this.initialState }))
                .catch(exc => this.dialogErrorSet(_("Storage pools could not be fetched"), exc.message));
    }

    validateParams() {
        const validationFailed = {};

        if (this.state.mode !== CUSTOM_PATH && !this.state.storagePoolName)
            validationFailed.storagePool = _("Please choose a storage pool");

        if (this.state.mode === CREATE_NEW) {
            if (!this.state.volumeName) {
                validationFailed.volumeName = _("Please enter new volume name");
            }
            if (poolTypesNotSupportingVolumeCreation.includes(this.state.storagePoolType)) {
                validationFailed.storagePool = cockpit.format(_("Pool type $0 does not support volume creation"), this.state.storagePoolType);
            }
            const poolCapacity = parseFloat(convertToUnit(this.props.storagePools.find(pool => pool.name == this.state.storagePoolName).capacity, units.B, this.state.unit));
            if (this.state.size > poolCapacity) {
                validationFailed.size = cockpit.format(_("Storage volume size must not exceed the storage pool's capacity ($0 $1)"), poolCapacity.toFixed(2), this.state.unit);
            }
        } else if (this.state.mode === USE_EXISTING) {
            if (this.state.mode !== CUSTOM_PATH && !this.state.existingVolumeName)
                validationFailed.existingVolumeName = _("Please choose a volume");
        }

        return validationFailed;
    }

    existingVolumeNameDelta(value, poolName) {
        const { storagePools, vm } = this.state;
        const stateDelta = { existingVolumeName: value };
        const pool = storagePools.find(pool => pool.name === poolName && pool.connectionName === vm.connectionName);
        if (!pool)
            return stateDelta;

        stateDelta.format = getDefaultVolumeFormat(pool);
        if (['dir', 'fs', 'netfs', 'gluster', 'vstorage'].indexOf(pool.type) > -1) {
            const volume = pool.volumes.find(vol => vol.name === value);
            if (volume && volume.format)
                stateDelta.format = volume.format;
        }
        return stateDelta;
    }

    getDefaultVolumeName(poolName) {
        const { storagePools, vm } = this.state;
        const vmStoragePool = storagePools.find(pool => pool.name == poolName);
        const filteredVolumes = getFilteredVolumes(vmStoragePool, vm.disks);
        return filteredVolumes[0] && filteredVolumes[0].name;
    }

    onValueChanged(key, value) {
        let stateDelta = {};
        const { storagePools, vm } = this.state;

        switch (key) {
        case 'storagePoolName': {
            const currentPool = storagePools.find(pool => pool.name === value && pool.connectionName === vm.connectionName);
            const prevPool = storagePools.find(pool => pool.name === this.state.storagePoolName && pool.connectionName === vm.connectionName);
            this.setState({ storagePoolName: value, storagePoolType: currentPool.type });
            // Reset the format only when the Format selection dropdown changes entries - otherwise just keep the old selection
            // All pool types apart from 'disk' have either 'raw' or 'qcow2' format
            if (currentPool && prevPool && ((currentPool.type == 'disk' && prevPool.type != 'disk') || (currentPool.type != 'disk' && prevPool.type == 'disk'))) {
                // use onValueChange instead of setState in order to perform subsequent state change logic
                this.onValueChanged('format', getDefaultVolumeFormat(value));
            }

            if (this.state.mode === USE_EXISTING) { // user changed pool
                // use onValueChange instead of setState in order to perform subsequent state change logic
                this.onValueChanged('existingVolumeName', this.getDefaultVolumeName(value));
            }
            break;
        }
        case 'existingVolumeName': {
            stateDelta.existingVolumeName = value;
            this.setState(prevState => { // to prevent asynchronous for recursive call with existingVolumeName as a key
                return this.existingVolumeNameDelta(value, prevState.storagePoolName);
            });
            break;
        }
        case 'mode': {
            this.setState(prevState => { // to prevent asynchronous for recursive call with existingVolumeName as a key
                stateDelta = this.initialState;
                stateDelta.mode = value;
                if (value === USE_EXISTING) { // user moved to USE_EXISTING subtab
                    const poolName = stateDelta.storagePoolName;
                    if (poolName)
                        stateDelta = { ...stateDelta, ...this.existingVolumeNameDelta(this.getDefaultVolumeName(poolName), prevState.storagePoolName) };
                }

                return stateDelta;
            });
            break;
        }
        case 'busType': {
            const existingTargets = Object.getOwnPropertyNames(this.props.vm.disks);
            const availableTarget = getNextAvailableTarget(existingTargets, value);
            this.setState({ busType: value, target: availableTarget });
            break;
        }
        case 'file': {
            if (value.endsWith(".iso")) {
                // use onValueChange instead of setState in order to perform subsequent state change logic
                this.onValueChanged("device", "cdrom");
            }
            this.setState({ file: value });
            break;
        }
        case 'device': {
            this.setState({ device: value });
            let newBus;
            // If disk with the same device exists, use the same bus too
            for (const disk of Object.values(this.props.vm.disks)) {
                if (disk.device === value) {
                    newBus = disk.bus;
                    break;
                }
            }

            if (newBus) {
                this.onValueChanged("busType", newBus);
                // Disk device "cdrom" and bus "virtio" are incompatible, see:
                // https://listman.redhat.com/archives/libvir-list/2019-January/msg01104.html
            } else if (value === "cdrom" && this.state.busType === "virtio") {
                // use onValueChange instead of setState in order to perform subsequent state change logic
                // According to https://libvirt.org/formatdomain.html#hard-drives-floppy-disks-cdroms (section about 'target'),
                // scsi is the default option for libvirt in this case too
                this.onValueChanged("busType", "scsi");
            }
            break;
        }
        default:
            this.setState({ [key]: value });
        }
    }

    dialogErrorSet(text, detail) {
        this.setState({ dialogError: text, dialogErrorDetail: detail });
    }

    onAddClicked() {
        const { vm, vms, storagePools } = this.state;
        let storagePool, volume, isVolumeUsed;
        const close = this.props.close;

        const validation = this.validateParams();
        if (Object.getOwnPropertyNames(validation).length > 0)
            return this.setState({ addDiskInProgress: false, validate: true });

        if (this.state.mode === CREATE_NEW) {
            this.setState({ addDiskInProgress: true, validate: false });
            // create new disk
            return storageVolumeCreateAndAttach({
                connectionName: vm.connectionName,
                poolName: this.state.storagePoolName,
                volumeName: this.state.volumeName,
                size: convertToUnit(this.state.size, this.state.unit, 'MiB'),
                format: this.state.format,
                target: this.state.target,
                permanent: this.state.permanent,
                hotplug: this.state.hotplug,
                vmName: vm.name,
                vmId: vm.id,
                cacheMode: this.state.cacheMode,
                busType: this.state.busType
            })
                    .then(() => { // force reload of VM data, events are not reliable (i.e. for a down VM)
                        close();
                        return domainGet({ connectionName: vm.connectionName, name: vm.name, id: vm.id });
                    })
                    .catch(exc => {
                        this.setState({ addDiskInProgress: false });
                        this.dialogErrorSet(_("Disk failed to be created"), exc.message);
                    });
        } else if (this.state.mode === USE_EXISTING) {
            // use existing volume
            storagePool = storagePools.find(pool => pool.name === this.state.storagePoolName);
            volume = storagePool.volumes.find(vol => vol.name === this.state.existingVolumeName);
            isVolumeUsed = getStorageVolumesUsage(vms, storagePool);
        }

        return domainAttachDisk({
            connectionName: vm.connectionName,
            type: this.state.mode === CUSTOM_PATH ? "file" : "volume",
            file: this.state.file,
            device: this.state.device,
            poolName: this.state.storagePoolName,
            volumeName: this.state.existingVolumeName,
            format: this.state.mode !== CUSTOM_PATH ? this.state.format : "raw", // TODO: let user choose format for disks with custom file path
            target: this.state.target,
            permanent: this.state.permanent,
            hotplug: this.state.hotplug,
            vmName: vm.name,
            vmId: vm.id,
            cacheMode: this.state.cacheMode,
            shareable: volume && volume.format === "raw" && isVolumeUsed[this.state.existingVolumeName],
            busType: this.state.busType
        })
                .then(() => { // force reload of VM data, events are not reliable (i.e. for a down VM)
                    const promises = [];
                    if (this.state.mode !== CUSTOM_PATH && volume.format === "raw" && isVolumeUsed[this.state.existingVolumeName]) {
                        isVolumeUsed[this.state.existingVolumeName].forEach(vmName => {
                            const vm = vms.find(vm => vm.name === vmName);
                            const diskTarget = getStorageVolumeDiskTarget(vm, storagePool, this.state.existingVolumeName);

                            promises.push(
                                domainUpdateDiskAttributes({ connectionName: vm.connectionName, objPath: vm.id, readonly: false, shareable: true, target: diskTarget })
                                        .catch(exc => this.dialogErrorSet(_("Disk settings could not be saved"), exc.message))
                            );
                        });

                        Promise.all(promises)
                                .then(() => close());
                    } else {
                        close();
                    }

                    return domainGet({ connectionName: vm.connectionName, name: vm.name, id: vm.id });
                })
                .catch(exc => {
                    this.setState({ addDiskInProgress: false });
                    this.dialogErrorSet(_("Disk failed to be attached"), exc.message);
                });
    }

    render() {
        const { dialogLoading, vm, storagePools, vms } = this.state;
        const idPrefix = `${this.props.idPrefix}-adddisk`;
        const validationFailed = this.state.validate ? this.validateParams() : {};

        let defaultBody;
        if (dialogLoading) {
            defaultBody = (
                <Bullseye>
                    <Spinner isSVG />
                </Bullseye>
            );
        } else {
            defaultBody = (
                <Form onSubmit={e => e.preventDefault()} isHorizontal>
                    <FormGroup fieldId={`${idPrefix}-source`}
                               id={`${idPrefix}-source-group`}
                               label={_("Source")} isInline hasNoPaddingTop>
                        <Radio id={`${idPrefix}-createnew`}
                               name="source"
                               label={_("Create new")}
                               isChecked={this.state.mode === CREATE_NEW}
                               onChange={() => this.onValueChanged('mode', CREATE_NEW)} />
                        <Radio id={`${idPrefix}-useexisting`}
                               name="source"
                               label={_("Use existing")}
                               isChecked={this.state.mode === USE_EXISTING}
                               onChange={e => this.onValueChanged('mode', USE_EXISTING)} />
                        <Radio id={`${idPrefix}-custompath`}
                               name="source"
                               label={_("Custom path")}
                               isChecked={this.state.mode === CUSTOM_PATH}
                               onChange={e => this.onValueChanged('mode', CUSTOM_PATH)} />
                    </FormGroup>
                    {this.state.mode === CREATE_NEW && (
                        <CreateNewDisk idPrefix={`${idPrefix}-new`}
                                       onValueChanged={this.onValueChanged}
                                       storagePoolName={this.state.storagePoolName}
                                       volumeName={this.state.volumeName}
                                       size={this.state.size}
                                       unit={this.state.unit}
                                       format={this.state.format}
                                       validationFailed={validationFailed}
                                       vmStoragePools={storagePools}
                                       vm={vm} />
                    )}
                    {this.state.mode === USE_EXISTING && (
                        <UseExistingDisk idPrefix={`${idPrefix}-existing`}
                                         onValueChanged={this.onValueChanged}
                                         storagePoolName={this.state.storagePoolName}
                                         existingVolumeName={this.state.existingVolumeName}
                                         validationFailed={validationFailed}
                                         vmStoragePools={storagePools}
                                         vms={vms}
                                         vm={vm} />
                    )}
                    {this.state.mode === CUSTOM_PATH && (
                        <CustomPath idPrefix={idPrefix}
                                    onValueChanged={this.onValueChanged}
                                    device={this.state.device} />
                    )}
                    {vm.persistent &&
                    <PermanentChange idPrefix={idPrefix}
                                     permanent={this.state.permanent}
                                     onValueChanged={this.onValueChanged}
                                     vm={vm} />}
                    <AdditionalOptions cacheMode={this.state.cacheMode}
                                       device={this.state.device}
                                       idPrefix={idPrefix}
                                       onValueChanged={this.onValueChanged}
                                       busType={this.state.busType}
                                       supportedDiskBusTypes={this.props.supportedDiskBusTypes} />
                </Form>
            );
        }

        return (
            <Modal position="top" variant="medium" id={`${idPrefix}-dialog-modal-window`} isOpen onClose={this.props.close}
                   title={_("Add disk")}
                   footer={
                       <>
                           {this.state.dialogError && <ModalError dialogError={this.state.dialogError} dialogErrorDetail={this.state.dialogErrorDetail} />}
                           <Button id={`${idPrefix}-dialog-add`}
                                   variant='primary'
                                   isLoading={this.state.addDiskInProgress}
                                   isDisabled={this.state.addDiskInProgress || dialogLoading || (storagePools.length == 0 && this.state.mode != CUSTOM_PATH)}
                                   onClick={this.onAddClicked}>
                               {_("Add")}
                           </Button>
                           <Button id={`${idPrefix}-dialog-cancel`} variant='link' className='btn-cancel' onClick={this.props.close}>
                               {_("Cancel")}
                           </Button>
                       </>
                   }>
                {defaultBody}
            </Modal>
        );
    }
}
