#!/bin/bash

rundir=/tmp/$RANDOM
echo "using rundir:$rundir"
mkdir $rundir

#./setup2.py hayashis IU-GALAXY nr latest /home/iugalaxy/test/samples/nr.5000 blastx '-evalue 0.001' $rundir
#./setup2.py hayashis IU-GALAXY nr latest /home/iugalaxy/test/samples/nr.38142 blastx '-evalue 0.001' $rundir
../setup.py hayashis IU-GALAXY nr latest /home/iugalaxy/test/samples/nr.70937 blastx '-evalue 0.001' $rundir

#cd $rundir
#condor_submit_dag blast.dag
#time condor_wait blast.dag.dagman.log
#echo "ret:" $?

#echo "dag completed - listing output"
#ls -la output/*.xml

