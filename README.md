osg-blast v1
=========

Distributed blast execution script for OSG

## Installation

On your grid submit host, do

```
git clone https://github.com/soichih/osg-blast.git 
```

Currently, osg-blast supports 2 execution modes. First one is to run against NCBI NR or NT databases. When you run against NR or NT, osg-blast will use segmented NR/NT database since running query against the entire DB will be too large. osg-blast will submits multiple jobs per each query blocks and merge results back to 1 when all results are computed. 
Another one is to run against your own custom DB. osg-blast will not split your DB in this mode, so you will need to make sure that the DB you are submitting is small enough (if it's too big, it needs to be hosted on osg-xsede).

## Running using OSG-XSEDE published NR / NT databases.

If you have queries that you'd like to run against NR or NT databases, run setup.py with something like following parameters to create your workflow.

```
./setup.py hayashis IU-GALAXY nr latest /home/iugalaxy/test/samples/nr.70937 blastx '-evalue 0.001' rundir
```

First 2 arguments "hayashis IU-GALAXY" sets your OSG Xsede project and user name to submit jobs under. If you are not running on osg-xsede, then you can just put "na na" or such.
3rd and 4th arguments tells which DB to use you can either put "nr latest" or "nt latest".
5th argument is the path to your input quereis in FASTA format.
6th is the type of blast executable to run. Executable will be downloaded from osg-xsede when you submit your job.
7th is the quote delimited list of argument to be passed to the blast. Please do not set -outfmt since osg-blast set it to XML format in order to be able to merge generated result.
8th argument (rundir) is the path to store your generated workflow and input / output. You can just create rundir subdirectory, or set it to /tmp/rundir, etc. The directory must exist prior to running your job.

You should probably create a separate shell script to contain all the input parameter so that you can edit them later.

Once setup.py creates your workflow, you can submit the workflow by "condor_submit_dag rundir/blast.dag"

## Running using your own custom DB.

If you have your own custom DB, first you will need to create a tar file containing your blast DB in a certain format. Please refer to following script.

```

input_fasta="/home/iugalaxy/test/samples/hg19.fasta" #path to your DB in fasta format
input_fasta_title="normal.fasta"
input_fasta_type=nucl
temp_dbdir=/tmp/build_db.$RANDOM

echo "create blast db from fasta"
mkdir rundir
mkdir $temp_dbdir
/home/iugalaxy/app/ncbi-blast-2.2.28+/bin/makeblastdb -in $input_fasta -dbtype $input_fasta_type -hash_index -out $temp_dbdir/blastdb -title "$input_fasta_title"
( cd $temp_dbdir && tar -cz * > rundir/db.tar.gz )

echo "clearning up temp dbdir"
rm -rf $temp_dbdir
```

Once you have your db.tar.gz stored in your rundir, you can then run following to create your workflow.

```
./setup_userdb.py hayashis IU-GALAXY /home/hayashis/test/sample.query blastp "-evalue 0.0001" rundir
```

Arguments are similar to NR/NT db submission mode, except you don't need to pass the name of the DB.

Once setup.py creates your workflow, you can then submit the workflow by "condor_submit_dag rundir/blast.dag"

If you have problem / questions, please contact hayashis@iu.edu


