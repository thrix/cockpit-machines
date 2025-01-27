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
import React from 'react';
import PropTypes from 'prop-types';
import {
    Button, Checkbox,
    DropdownItem,
    Form, FormGroup,
    HelperText, HelperTextItem,
    Modal,
    Stack, Tooltip
} from '@patternfly/react-core';
import { InfoIcon } from '@patternfly/react-icons';

import { getStorageVolumesUsage, storagePoolId } from '../../helpers.js';
import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { storageVolumeDelete } from '../../libvirtApi/storageVolume.js';
import { storagePoolDeactivate, storagePoolUndefine } from '../../libvirtApi/storagePool.js';
import cockpit from 'cockpit';

const _ = cockpit.gettext;

/*
 * Finds out if any volume is used as a disk independently
 * with no reference to a pool (e.g. using direct volume path).
 * If so, then pool can be deleted but only without its content.
 *
 * @param {object} pool
 * @param {array} vms
 * returns {boolean}
 */
function canDeleteOnlyWithoutVolumes(pool, vms) {
    if (!canDelete(pool, vms))
        return false;

    const isVolumeUsed = getStorageVolumesUsage(vms, pool);

    for (const property in isVolumeUsed) {
        if (isVolumeUsed[property].length > 0)
            return true;
    }

    return false;
}

/*
 * Finds out if any disk uses pool name in it's definition.
 * If so, then pool cannot be deleted with nor without its content.
 *
 * @param {object} pool
 * @param {array} vms
 * returns {boolean}
 */
function canDelete(pool, vms) {
    for (let i = 0; i < vms.length; i++) {
        const vm = vms[i];
        const disks = Object.values(vm.disks);

        if (disks.some(disk => disk.source.pool === pool.name))
            return false;
    }

    return true;
}

function getPoolDeleteHelperText(vms, storagePool) {
    const usage = getStorageVolumesUsage(vms, storagePool);
    let vmsUsage = [];
    for (const property in usage)
        vmsUsage = vmsUsage.concat(usage[property]);

    vmsUsage = [...new Set(vmsUsage)]; // remove duplicates
    return (
        <>
            {_("Pool's volumes are used by VMs ")}
            <b> {vmsUsage.join(', ') + "."} </b>
            {_("Detach the disks using this pool from any VMs before attempting deletion.")}
        </>
    );
}

export class StoragePoolDelete extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            dialogError: undefined,
            deleteVolumes: false,
        };
        this.delete = this.delete.bind(this);
        this.onValueChanged = this.onValueChanged.bind(this);
        this.dialogErrorSet = this.dialogErrorSet.bind(this);
    }

    onValueChanged(key, value) {
        const stateDelta = { [key]: value };

        this.setState(stateDelta);
    }

    dialogErrorSet(text, detail) {
        this.setState({ dialogError: text, dialogErrorDetail: detail });
    }

    delete() {
        const storagePool = this.props.storagePool;
        const volumes = storagePool.volumes || [];
        const storagePoolDeactivateAndUndefine = (storagePool) => {
            if (storagePool.active) {
                return storagePoolDeactivate({ connectionName: storagePool.connectionName, objPath: storagePool.id })
                        .then(() => storagePoolUndefine({ connectionName: storagePool.connectionName, objPath: storagePool.id }));
            } else {
                return storagePoolUndefine({ connectionName: storagePool.connectionName, objPath: storagePool.id });
            }
        };

        if (this.state.deleteVolumes && storagePool.volumes.length > 0) {
            Promise.all(volumes.map(volume => storageVolumeDelete({ connectionName: storagePool.connectionName, poolName: storagePool.name, volName: volume.name })))
                    .then(() => storagePoolDeactivateAndUndefine(storagePool))
                    .then(() => this.props.close,
                          exc => this.dialogErrorSet(_("The storage pool could not be deleted"), exc.message));
        } else {
            storagePoolDeactivateAndUndefine(storagePool)
                    .then(() => this.props.close,
                          exc => this.dialogErrorSet(_("The storage pool could not be deleted"), exc.message));
        }
    }

    render() {
        const { storagePool, vms } = this.props;
        const volumes = storagePool.volumes || [];

        const showWarning = () => {
            if (canDeleteOnlyWithoutVolumes(storagePool, vms) && this.state.deleteVolumes) {
                return (
                    <HelperText>
                        <HelperTextItem icon={<InfoIcon />}>
                            {getPoolDeleteHelperText(vms, storagePool)}
                        </HelperTextItem>
                    </HelperText>
                );
            }
        };

        const defaultBody = (
            <Stack hasGutter>
                <Form isHorizontal>
                    { storagePool.active && volumes.length > 0 &&
                    <FormGroup label={_("Delete content")} fieldId='storage-pool-delete-volumes' hasNoPaddingTop>
                        <Checkbox id='storage-pool-delete-volumes'
                                  isChecked={this.state.deleteVolumes}
                                  label={_("Delete the volumes inside this pool")}
                                  onChange={checked => this.onValueChanged('deleteVolumes', checked)} />
                    </FormGroup>}
                    { !storagePool.active && _("Deleting an inactive storage pool will only undefine the pool. Its content will not be deleted.")}
                </Form>
                { storagePool.active && showWarning() }
            </Stack>
        );

        return (
            <Modal position="top" variant="medium" isOpen onClose={this.props.close}
                   title={cockpit.format(_("Delete storage pool $0"), storagePool.name)}
                   footer={
                       <>
                           {this.state.dialogError && <ModalError dialogError={this.state.dialogError} dialogErrorDetail={this.state.dialogErrorDetail} />}
                           <Button variant='danger'
                               onClick={this.delete}
                               isDisabled={canDeleteOnlyWithoutVolumes(storagePool, vms) && this.state.deleteVolumes}>
                               {_("Delete")}
                           </Button>
                           <Button variant='link' className='btn-cancel' onClick={this.props.close}>
                               {_("Cancel")}
                           </Button>
                       </>
                   }>
                {defaultBody}
            </Modal>
        );
    }
}
StoragePoolDelete.propTypes = {
    storagePool: PropTypes.object.isRequired,
    vms: PropTypes.array.isRequired,
    close: PropTypes.func.isRequired,
};

export const StoragePoolDeleteAction = ({ storagePool, open, vms }) => {
    const id = storagePoolId(storagePool.name, storagePool.connectionName);
    let tooltipText;
    if (!canDelete(storagePool, vms)) {
        tooltipText = getPoolDeleteHelperText(vms, storagePool);
    } else if (!storagePool.persistent) {
        tooltipText = _("Non-persistent storage pool cannot be deleted. It ceases to exists when it's deactivated.");
    }

    if (!canDelete(storagePool, vms) || !storagePool.persistent) {
        return (
            <Tooltip id='delete-tooltip'
                     content={tooltipText}>
                <span>
                    <DropdownItem id={`delete-${id}`}
                                  className='pf-m-danger'
                                  isAriaDisabled>
                        {_("Delete")}
                    </DropdownItem>
                </span>
            </Tooltip>
        );
    } else {
        return (
            <DropdownItem id={`delete-${id}`}
                          className='pf-m-danger'
                          onClick={open}>
                {_("Delete")}
            </DropdownItem>
        );
    }
};
