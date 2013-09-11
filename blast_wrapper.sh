#!/bin/bash

blast_type=$1
query_path=$2
db=$3
dburl=$4
part=$5
output_path=$6
blast_opt=`cat blast.opt`

echo `date` ": running on" `hostname`
env

echo "downloading blastdb"
time curl -O $dburl/$db.$part.tar.gz

echo "unzipping blastdb"
time tar -xzf $db.$part.tar.gz

echo "checking"
ls -la .

echo "running blast" `date`
mkdir output
dbname=$db.`printf "%02d" $part`
echo "./$blast_type $blast_opt -db $dbname -query $query_path -out $output_path -outfmt 5"
./$blast_type $blast_opt -db $dbname -query $query_path -out $output_path -outfmt 5
blast_ret=$?
echo `date` ":blast ended at" `date` "ret:$blast_ret"
case $blast_ret in
0)
    echo "success"
    exit 0
    ;;
1)
    echo "Error in query sequence(s) or BLAST options"
    exit 0
    ;;
2)
    echo "Error in blast database"
    exit 1
    ;;
3)
    echo "Error in blast engine"
    exit 1
    ;;
4)
    echo "out of memory"
    exit 1
    ;;
127)
    echo "no blastp"
    exit 1
    ;;
*)
    echo "unknown error"
    exit 1
    ;;
esac

