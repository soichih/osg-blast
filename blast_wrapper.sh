#!/bin/bash


blast_path=$1
blast_type=$2
query_path=$3
db=$4
dburl=$5
part=$6
output_path=$7
blast_opt=`cat blast.opt`

echo "creating output directory"
mkdir output

echo "touching empty output file - to prevent shadow exception"
touch $output_path

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
	rm $db.*
	rm $blast_type
	rm $query_path
        #rm $output_path

	#echo "after clean up.."
	#ls -la .
}

echo "downloading blast bin"
curl -m 120 -H "Pragma:" -O $blast_path/$blast_type.gz
if [ $? -ne 0 ]; then
    echo "blast bin download failed through squid.. trying without it"
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

echo "downloading blastdb" 
time curl -m 3000 -H "Pragma:" -O $dburl/$db.$part.tar.gz #50 minutes seems way too long.. but some sites are very slow (MTWT2..)
if [ $? -ne 0 ]; then
    echo "failed to download db.. exiting"
    clean_workdir
    exit 1
fi

echo "unzipping blastdb"
tar -xzf $db.$part.tar.gz 2>&1
if [ $? -ne 0 ]; then
    echo "failed to untar blastdb.. exiting"
    clean_workdir
    exit 1
fi

#debug..
ls -la .

#limit memory at 2G
ulimit -v 2048000

echo `date` "starting blast"
dbname=$db.`printf "%02d" $part`
echo "./$blast_type $blast_opt -db $dbname -query $query_path -out $output_path -outfmt 5"
time ./$blast_type $blast_opt -db $dbname -query $query_path -out $output_path -outfmt 5
blast_ret=$?
echo `date` "blast ended with code:$blast_ret"

clean_workdir

case $blast_ret in
0)
    echo "testing output xml integrity"
    xmllint --noout --stream $output_path
    if [ $? -ne 0 ]; then
	    echo "xml is malformed (probably truncated?).."
            mv $output_path ${output_path}.malformed
	    exit 1
    fi
    echo "looks good.. zipping up"
    gzip $output_path
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
    echo "probably killed by SIGKILL(128+9).. out of memory / preemption / etc.."
    exit 5 #full abort
    ;;
*)
    echo "unknown error code: $blast_ret"
    exit 5 #full abort
    ;;
esac


