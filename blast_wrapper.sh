#!/bin/bash

blast_path=$1
blast_type=$2
query_path=$3
db=$4
dburl=$5
part=$6
output_path=$7
blast_opt=`cat blast.opt`

echo `date` ": running on" `hostname`
env

export OSG_SQUID_LOCATION=${OSG_SQUID_LOCATION:-UNAVAILABLE}
if [ "$OSG_SQUID_LOCATION" != UNAVAILABLE ]; then
    echo "using squid:" $OSG_SQUID_LOCATION
    export http_proxy=$OSG_SQUID_LOCATION
else
    echo "OSG_SQUID_LOCATION is not set... not using squid"
fi

###################################################################################################
#
#site specific configs
#

if [ "$OSG_SITE_NAME" == "RENCI-Blueridge" ]; then
    echo "It's RENCI-Blueridge... need to set http_proxy manually"
    export http_proxy="http://extgw-0-1.local:3128/"
fi

###################################################################################################

echo "downloading & unzipping blast bin"
time 2>&1 curl -m 60 -H "Pragma:" -O $blast_path/$blast_type.gz
gunzip $blast_type.gz
chmod +x $blast_type

echo "downloading blastdb"
time 2>&1 curl -m 300 -H "Pragma:" -O $dburl/$db.$part.tar.gz

echo "unzipping blastdb"
time 2>&1 tar -xzf $db.$part.tar.gz 2>&1

echo "checking"
ls -la .

echo "running blast" `date`
mkdir output
dbname=$db.`printf "%02d" $part`
echo "./$blast_type $blast_opt -db $dbname -query $query_path -out $output_path -outfmt 5"
time 2>&1 ./$blast_type $blast_opt -db $dbname -query $query_path -out $output_path -outfmt 5
blast_ret=$?
echo `date` ":blast ended at" `date` "ret:$blast_ret"
case $blast_ret in
0)
    echo "success"
    gzip $output_path
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

