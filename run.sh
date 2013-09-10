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

#./setup.py OSG-Staff nr ../sample/query.trinity.10000.txt blastp "-outfmt 5"
tmpfile=/tmp/run.sh.$RANDOM
./setup.py IU-GALAXY nr "09-09-2013" ../sample/query.trinity.1.txt blastx "-evalue 0.5" > $tmpfile
cat $tmpfile
bash $tmpfile

#echo "submitting"
#condor_submit block_0.sub

#blast xml output can be merged used a script like
#https://bitbucket.org/peterjc/galaxy-central/src/5cefd5d5536e/tools/ncbi_blast_plus/blast.py
