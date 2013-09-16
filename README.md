osg-blast
=========

Distributed blast execution script for OSG

In order to submit to osg-xsede via bosco, you will need do

1) On osg-xsede, create a file ~/.xsede_default_project and put 
IU-GALAXY
inside the file (or whichever the project that you have access to). This will tell osg-xsede to use this name as project when submitted from bosco.

2) On your bosco submit node, update ~/bosco/local.bosco/condor_config.local to contains following at the end
GRIDMANAGER_MAX_SUBMITTED_JOBS_PER_RESOURCE=100000
This will make bosco to not limit the number of jobs submitted to osg-xsede
