#!/bin/bash

echo "listing all site where I can currently submit jobs to"
condor_status -constraints 'HAS_CVMFS_oasis_opensciencegrid_org =?= True' -format '%s\n' GLIDEIN_ResourceName | sort | uniq
