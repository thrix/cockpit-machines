#!/bin/sh
set -eux

# tests need cockpit's bots/ libraries and test infrastructure
cd $SOURCE
git init
rm -f bots  # common local case: existing bots symlink
make bots test/common test/reference

# support running from clean git tree
if [ ! -d node_modules/chrome-remote-interface ]; then
    # copy package.json temporarily otherwise npm might try to install the dependencies from it
    mv package.json .package.json
    npm install chrome-remote-interface sizzle
    mv .package.json package.json
fi

# disable detection of affected tests; testing takes too long as there is no parallelization,
# and TF machines are slow and brittle
mv .git dot-git

. /etc/os-release
export TEST_OS="${ID}-${VERSION_ID/./-}"

if [ "${TEST_OS#centos-}" != "$TEST_OS" ]; then
    TEST_OS="${TEST_OS}-stream"
fi

export TEST_AUDIT_NO_SELINUX=1

#
# exclude known-broken tests
#
EXCLUDES=""

# FIXME: Fails everywhere on the Testing Farm but not locally with tmt virtual
EXCLUDES="$EXCLUDES TestMachinesNetworks.testNetworkAddStaticDCHPHosts"

if [ "$ID" = "rhel" ]; then
    EXCLUDES="$EXCLUDES
              TestMachinesDisks.testDetachDisk
              TestMachinesDisks.testDiskEdit
              TestMachinesNetworks.testNetworkSettings
    "
fi

if [ "$TEST_OS" = "centos-8-stream" ]; then
    EXCLUDES="$EXCLUDES TestMachinesConsoles.testExternalConsole"
fi

if [ "$TEST_OS" = "fedora-35" ] || [ "$TEST_OS" = "fedora-36" ] || [ "$TEST_OS" = "centos-9-stream" ]; then
    EXCLUDES="$EXCLUDES TestMachinesHostDevs.testHostDevAdd"
    # https://github.com/cockpit-project/cockpit-machines/issues/526
    EXCLUDES="$EXCLUDES TestMachinesCreate.testCreateThenInstall"
fi

if [ "$TEST_OS" = "fedora-36" ]; then
    EXCLUDES="$EXCLUDES
              TestMachinesNICs.testNICDelete
              TestMachinesConsoles.testSerialConsole
    "
fi

if [ "$ID" = "fedora" ]; then
    # Testing Farm machines are really slow in European evenings
    export TEST_TIMEOUT_FACTOR=3
fi

# pre-download cirros image for Machines tests
bots/image-download cirros

exclude_options=""
for t in $EXCLUDES; do
    exclude_options="$exclude_options --exclude $t"
done

# execute run-tests
RC=0
test/common/run-tests --nondestructive $exclude_options \
    --machine localhost:22 --browser localhost:9090 || RC=$?

echo $RC > "$LOGS/exitcode"
cp --verbose Test* "$LOGS" || true
# deliver test result via exitcode file
exit 0
