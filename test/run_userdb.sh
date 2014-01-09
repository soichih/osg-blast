#!/bin/bash

rundir=/local-scratch/iugalaxy/tmp/$RANDOM
echo "using rundir:$rundir"
mkdir $rundir

blast=blastn
blast_ops="-evalue 0.001"
blast_ops="-evalue 0.001 -best_hit_score_edge 0.05 -best_hit_overhang 0.25 -perc_identity 98.0"
input_fasta="/home/iugalaxy/test/samples/hg19.fasta"
input_fasta_type=nucl #nucl or prot
input_fasta_title="normal.fasta" 
#input_query="/home/iugalaxy/test/samples/normal.fasta.50000"
#input_query="/home/iugalaxy/test/samples/normal.fasta.1000000" #1m
input_query="/home/iugalaxy/test/samples/normal.fasta.100000000" #100m

echo "create blast db from $input_fasta"
temp_dbdir=/local-scratch/iugalaxy/tmp/build_db.$RANDOM
mkdir $temp_dbdir
time /home/iugalaxy/app/ncbi-blast-2.2.28+/bin/makeblastdb -in $input_fasta -dbtype $input_fasta_type -hash_index -out $temp_dbdir/blastdb -title "$input_fasta_title"
cd $temp_dbdir
tar -cz * > $rundir/db.tar.gz
cd -
rm -rf $temp_dbdir

echo "setting up rundir"
../setup_userdb.py hayashis IU-GALAXY $input_query $blast "$blast_ops" $rundir

#cd $rundir
#condor_submit_dag blast.dag
#time condor_wait blast.dag.dagman.log
#echo "ret:" $?

#echo "dag completed - listing output"
#ls -la output/*.xml

