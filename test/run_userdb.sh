#!/bin/bash

mkdir -p /tmp/rundir
rundir=/tmp/rundir/$RANDOM
echo "using rundir:$rundir"
mkdir $rundir

blast=blastn
blast_ops="-evalue 0.001 -best_hit_score_edge 0.05 -best_hit_overhang 0.25 -perc_identity 98.0"
input_fasta="/home/hayashis/git/osg-blast/test/fasta/hs_alt_CHM1_1.1_chr22.fa" #must be absolute path
input_fasta_type=nucl #nucl or prot
input_fasta_title="chr22.fasta"
#input_query="/home/iugalaxy/test/samples/normal.fasta.50000"

echo "create blast db from $input_fasta"
mkdir -p $rundir/$input_fasta_title
(cd $rundir/$input_fasta_title && time ~/app/ncbi-blast-2.2.28+/bin/makeblastdb -in $input_fasta -dbtype $input_fasta_type -hash_index -out blastdb -title "$input_fasta_title")
(cd $rundir && tar -cz $input_fasta_title > userdb.tar.gz)
rm -rf $rundir/$input_fasta_title

echo "setting up rundir"
(cd .. && ./setup_userdb.py hayashis IU-GALAXY $input_query $blast "$blast_ops" $rundir)

#cd $rundir
#condor_submit_dag blast.dag
#time condor_wait blast.dag.dagman.log
#echo "ret:" $?

#echo "dag completed - listing output"
#ls -la output/*.xml

