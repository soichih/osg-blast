#!/bin/bash

blast_path=$1
blast_type=$2
part=$3
output_path=$4
db_url=$5

blast_opt=`cat blast.opt`
query_path=block_$part

echo "unzipping $query_path.gz"
gunzip $query_path.gz

echo "creating output directory"
mkdir output

echo `date` ": running on" `hostname` `uname -a`
env | grep OSG
cat /etc/issue

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

#if [ "$OSG_SITE_NAME" == "RENCI-Blueridge" ]; then
#    echo "It's RENCI-Blueridge... need to set http_proxy manually"
#    export http_proxy="http://extgw-0-1.local:3128/"
#fi

###################################################################################################

function clean_workdir {
	echo "cleaning up workdir"
	rm blastdb.*
	rm db.tar.gz
	rm $blast_type
	rm $query_path

	#echo "after clean up.."
	#ls -la .
}

echo "downloading blast bin"
curl -m 120 -H "Pragma:" -O $blast_path/$blast_type.gz
if [ $? -ne 0 ]; then
    echo "download failed through squid.. trying without it"
    unset http_proxy
    curl -m 120 -H "Pragma:" -O $blast_path/$blast_type.gz
    if [ $? -ne 0 ]; then
        echo "failed again.. exiting"
	clean_workdir
        exit 1
    fi
fi

echo "unzipping blast bin"
gunzip $blast_type.gz
if [ $? -ne 0 ]; then
    echo "failed to unzip blast.gz - dumping content for debug.."
    cat $blast_type.gz
    clean_workdir
    exit 1
fi
chmod +x $blast_type

echo "downloading blast user db from $db_url"
curl -m 5000 -H "Pragma:" $db_url -o db.tar.gz
if [ $? -ne 0 ]; then
    echo "failed to download user db"
    clean_workdir
    exit 1
fi

echo "unzipping blastdb"
tar -xzf db.tar.gz 2>&1
if [ $? -ne 0 ]; then
    echo "failed to untar blastdb"
    clean_workdir
    exit 1
fi

#debug..
ls -la .

#BATCH_SIZE is ignored for blastn - which uses "adaptive approach" http://www.ncbi.nlm.nih.gov/books/NBK1763/
export BATCH_SIZE=2500 #attempt to limit virtual size at the expense for execution time

#limit memory at 2G
ulimit -v 2048000

echo `date` "starting blast"
echo "./$blast_type $blast_opt -db blastdb -query $query_path -out $output_path -outfmt 5"
time 2>&1 ./$blast_type $blast_opt -db blastdb -query $query_path -outfmt 5 | gzip > $output_path.gz
blast_ret=${PIPESTATUS[0]}
echo `date` "blast ended with code:$blast_ret"
ls -la output
clean_workdir
case $blast_ret in
0)
    echo "testing output xml integrity"
    gunzip -c $output_path.gz | xmllint --noout --stream -
    if [ $? -ne ${PIPESTATUS[1]} ]; then
	    echo "xml is malformed (probably truncated?).."
            mv $output_path.gz ${output_path}.gz.malformed
	    exit 1
    fi
    echo "success"
    exit 0
    ;;
1)
    echo "Error in query sequence(s) or BLAST options"
    exit 0 #mark as done
    ;;
2)
    echo "Error in blast database"
    exit 1 #retry
    ;;
3)
    echo "Error in blast engine"
    exit 1 #retry
    ;;
4)
    echo "out of memory"
    exit 5 #full abort
    ;;
127)
    echo "no blastp"
    exit 1 #retry
    ;;
137)
    echo "probably killed by SIGKILL(128+9)" #preemption or memory 
    exit 5 #full abort
    ;;
*)
    echo "unknown error code: $blast_ret"
    exit 5 #full abort
    ;;
esac

