#!/bin/bash

#echo "listing";
#condor_status -format '%s' GLIDEIN_ResourceName -format ' %s\n' HAS_CVMFS_oasis_opensciencegrid_org | sort | uniq

#echo "listing all site where I can currently submit jobs to"
echo "test\n\n";
condor_status -constraints '(HAS_CVMFS_oasis_opensciencegrid_org =?= True) && (Memory >= 2000) && (Disk >= 200*1024*1024)' -format '%s\n' GLIDEIN_ResourceName | sort | uniq

echo "check\n\n";
condor_status -constraints '(HAS_CVMFS_oasis_opensciencegrid_org =?= True) && (Memory >= 2000) && (Disk >= 500*1024*1024)' -format '%s\n' GLIDEIN_ResourceName | sort | uniq
