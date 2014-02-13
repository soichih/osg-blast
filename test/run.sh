#!/bin/bash

rundir=/tmp/$RANDOM
echo "using rundir:$rundir"
mkdir $rundir

#(cd .. && /setup.py hayashis IU-GALAXY nr latest /home/iugalaxy/test/samples/nr.70937 blastx '-evalue 0.001' $rundir)
(cd .. && ./setup.py hayashis IU-GALAXY nr latest /home/iugalaxy/test/samples/nr.100 blastx '-evalue 0.001' $rundir)

cd $rundir
condor_submit_dag blast.dag
time condor_wait blast.dag.dagman.log

exitcode=`tail -1 blast.dag.dagman.out | rev | cut -f1 -d' '`
echo "dag exit code " $exitcode

if [ $exitcode -eq 0 ];then
    echo "Workflow completed successfully"

    #TODO - your output file should be under output
    ls -la output/*

    #TODO - your log file should be under logs
    ls -la log/*
else
    echo "Workflow failed"
fi


