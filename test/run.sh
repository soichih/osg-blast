#!/bin/bash

rundir=/tmp/$RANDOM
echo "using rundir:$rundir"
mkdir $rundir

(cd .. && ./setup.py hayashis IU-GALAXY nr latest /home/hayashis/git/osg-blast/sample/nr.5000 blastx '-evalue 0.001' $rundir)

#cd $rundir
#condor_submit_dag blast.dag
#time condor_wait blast.dag.dagman.log
#echo "ret:" $?

#echo "dag completed - listing output"
#ls -la output/*.xml

