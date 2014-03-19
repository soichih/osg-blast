#!/bin/bash

echo "hostname" `hostname`

echo "OSG env"
set | grep OSG

echo "sourcing params";
cat params.sh

echo "prevent condor to issue hold event before terminating with any error code"
touch output

source ./params.sh

#export PATH=$PATH:/cvmfs/oasis.opensciencegrid.org/osg/projects/IU-GALAXY/rhel6/x86_64/ncbi-blast-2.2.29+/bin
#export PATH=$PATH:/cvmfs/oasis.opensciencegrid.org/osg/projects/OSG-Staff/rhel6/x86_64/node-v0.10.25-linux-x64/bin

#limit memory at 2G
ulimit -v 2048000

if [ $oasis_dbpath ]; then
    echo "using oasis db"

    if [ ! -d /cvmfs/oasis.opensciencegrid.org ]; then
        env | sort
        echo "can't access /cvmfs/oasis.opensciencegrid.org"
        exit 68
    fi

    #echo "listing oasis projects avaialble"
    #ls -lart /cvmfs/oasis.opensciencegrid.org
    #ls -lart /cvmfs/oasis.opensciencegrid.org/osg/projects
    #ls -lart /cvmfs/oasis.opensciencegrid.org/osg/projects/IU-GALAXY
    #echo "blastdb available in oasis"
    #ls -lart /cvmfs/oasis.opensciencegrid.org/osg/projects/IU-GALAXY/blastdb

    echo "listing $oasis_dbpath"
    ls -lart $oasis_dbpath

    if [ ! -f $oasis_dbpath/$dbname.tar.gz ]; then
        echo "can access oasis, but can't find $oasis_dbpath/$dbname.tar.gz - probably wrong dbname?"
        exit 3
    fi

    #create subdirectory so that condor won't try to ship it back to submit host accidentally
    mkdir blastdb
    echo "un-tarring blast db from $oasis_dbpath/$dbname.tar.gz to ./blastdb/"
    (cd blastdb && tar -xzf $oasis_dbpath/$dbname.tar.gz)

    if [ $? -ne 0 ]; then 
        echo "failed to untar $oasis_dbpath/$dbname.tar.gz - let's retry.."
        exit 16
    fi
else
    echo "downloading user db - through squid";

    #need to deal with squid server.. https://twiki.grid.iu.edu/bin/view/Documentation/OsgHttpBasics
    export OSG_SQUID_LOCATION=${OSG_SQUID_LOCATION:-UNAVAILABLE}
    if [ "$OSG_SQUID_LOCATION" != UNAVAILABLE ]; then
        echo "using squid:" $OSG_SQUID_LOCATION
        export http_proxy=$OSG_SQUID_LOCATION

        #test squid access (and throughput... TODO - I need to use reliable, but large enough test data)
        wget -q --timeout=2 http://google.com
        if [ $? -ne 0 ]; then
            echo "wget failed through squid.."
            exit 15
        fi
    else
        echo "OSG_SQUID_LOCATION is not set... not using squid"
    fi

    echo "downloading user db from $user_dbpath/$dbname.tar.gz"
    time wget -q --timeout=30 $user_dbpath/$dbname.tar.gz
    if [ $? -ne 0 ]; then 
        echo "failed to download $user_dbpath/$dbname.tar.gz"
        exit 16
    fi

    #create subdirectory so that condor won't try to ship it back to submit host accidentally
    mkdir blastdb
    (cd blastdb && tar -xzf ../$dbname.tar.gz)
fi

ls -lart blastdb

echo "head of $inputquery"
head -20 $inputquery

echo "running blast"
#-outfmt 5 : xml
#-outfmt 6 : tabular
#-outfmt 7 : tabular (with comments)
#-outfmt 10 : csv
#-outfmt 11 : asn.1

export BLASTDB=blastdb

echo ./$blast -query $inputquery -db $dbname -out output $blast_opts $blast_dbsize
time ./$blast -query $inputquery -db $dbname -out output $blast_opts $blast_dbsize
blast_ret=$?

echo "blast returned code: $blast_ret"
ls -la

#report return code
case $blast_ret in
0)
    #echo "validating output"
    #xmllint --noout --stream output
    #if [ $? -ne 0 ]; then
    #    echo "xml is malformed (probably truncated?).."
    #    exit 11 #produced invalid output
    #else
    #    echo "all good"
    #    exit 0
    #fi
    exit 0
    ;;
1)
    echo "Error in query sequence(s) or BLAST options"
    exit 1 #input error
    ;;
2)
    echo "Error in blast database"
    exit 1 #input error
    ;;
3)
    echo "Error in blast engine"
    exit 12
    ;;
4)
    echo "out of memory"
    exit 2
    ;;
127)
    echo "no blastp"
    exit 12
    ;;
137)
    echo "probably killed by SIGKILL(128+9).. out of memory / preemption / etc.."
    exit 2
    ;;
139)
    echo "blast segfaulted"
    exit 14
    ;;
255)
    echo "NCBI C++ Exception?"
    exit 13
    ;;
*)
    echo "unknown error code: $blast_ret"
    exit 9
    ;;
esac

exit $blast_ret
