#!/bin/bash

#blast output
#-outfmt <String>
#alignment view options:
#0 = pairwise,
#1 = query-anchored showing identities,
#2 = query-anchored no identities,
#3 = flat query-anchored, show identities,
#4 = flat query-anchored, no identities,
#5 = XML Blast output,
#6 = tabular,
#7 = tabular with comment lines,
#8 = Text ASN.1,
#9 = Binary ASN.1,
#10 = Comma-separated values,
#11 = BLAST archive format (ASN.1)

#!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
#!!!!!!!!!!!!!!!!W  A  R  N  I  N  G !!!!!!!!!!!!!!!!!!!!!!!
#!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
#BLAST OPTION WILL BE CARRIED TO THE ACTUAL COMMAND EXECUTED ON EACH CLUSTER
#NEVER COPY WHAT USER PROVIDES VIA GUI!!!!!!!!!!!!!!!!!!!!!!

#source ~/bosco/bosco_setenv
#bosco_start
#echo "making sure condor starts up"
#sleep 2

#nr
rundir=`./setup.py IU-GALAXY nr latest sample/nr.70937 blastx '-evalue 0.5'`
#rundir=`./setup.py IU-GALAXY nr latest sample/nr.38142 blastx '-evalue 0.5'`
#rundir=`./setup.py IU-GALAXY nr latest sample/nr.5000 blastx '-evalue 0.5'`
#rundir=`./setup.py IU-GALAXY nr latest sample/nr.1000 blastx '-evalue 0.5'`
#rundir=`./setup.py IU-GALAXY nr latest sample/nr.100 blastx '-evalue 0.5'`

#nt
#rundir=`./setup.py IU-GALAXY nt latest sample/nr.1000 blastx '-evalue 0.5'`

echo "rundir:" $rundir
cd $rundir
condor_submit_dag blast.dag
time condor_wait blast.dag.dagman.log
echo "ret:" $?

echo "dag completed - listing output"
ls -la output/*.xml

