#!/bin/bash

blast_path=$1
blast_type=$2
part=$3
output_path=$4

blast_opt=`cat blast.opt`
query_path=block_$part

echo "creating output directory"
mkdir output

echo `date` ": running on" `hostname` `uname -a`
env
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

	echo "after clean up.."
	ls -la .
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

echo "unzipping blastdb"
tar -xzf db.tar.gz 2>&1
if [ $? -ne 0 ]; then
    echo "failed to untar blastdb"
    clean_workdir
    exit 1
fi

#debug..
ls -la .

echo `date` "starting blast"
echo "./$blast_type $blast_opt -db blastdb -query $query_path -out $output_path -outfmt 5"
time 2>&1 ./$blast_type $blast_opt -db blastdb -query $query_path -out $output_path -outfmt 5
blast_ret=$?
echo `date` "blast ended with code:$blast_ret"

clean_workdir

case $blast_ret in
0)
    echo "testing output xml integrity"
    xmllint --noout $output_path
    if [ $? -ne 0 ]; then
	    echo "xml is malformed.."
	    clean_workdir
	    exit 1
    fi
    echo "looks good.. zipping up"

    gzip $output_path
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

