## OSG Blast (V2)

ncbi-blast workflow submission script

osg-blast submits a workflow to run blast search on a large input queries against a large blast database. 
osg-blast is intended to run on Open Science Grid, and on a glidein enabled submit host (such as osg-xsede or OSGconnect).

# Install blast from ncbi

First you need to download the latest blast executable from
ftp://ftp.ncbi.nlm.nih.gov/blast/executables/blast+/LATEST/ncbi-blast-2.2.30+-x64-linux.tar.gz
Be sure to add /bin directory to your PATH

# Install osg-blast

```
npm install osg-blast -g
```

If you don't have npm installed, you can do so by 

```
sudo yum install npm
```

If you don't have sudo access, you can download & install nodejs on your home directory from http://nodejs.org/. Make sure to add path to nodejs's bin directory if you install locally.

# Running osg-blast

Step 1. Place some fasta input query inside an empty directory.

Or you can use following example.. (input.fasta)

```
>comp7_c0_seq1 len=222 path=[382:0-221]
CCACTCGGAAATCTCATCTGAGAACACCGACAACCGGACCATTCGTGCGACGGCGGAGTA
CAAGCCCGGCTCGGGCCTGCACTACTTTGAAGTCGAATCCCGCTGCCCCAAGGAGGTGCA
ATACCACCCGTACGTCGGTCTGTGCTCCACCAATGAGGCCGTGCCGGTGGAGAAGATGCT
GATGTGGCTCAGCGATCTGTGCTACGCCTACGGCGGGGAAGG
>comp55_c0_seq1 len=228 path=[206:0-227]
GCCGCGTATTCTCGTAGCATGTCCGGGGTGGGCTGGGTCTGCGCTCCATTCATCACCGCC
ACTTGGGGGAGACCATGCTCCTTCAGATCGCGCTCCAAGGCGTCCATCGCCCCCATACCT
TTAGTATGGTTCCCCGAATAGATGACTAAGAACTTACATCCCGCGAGTTGACGATACAGA
CGGCTCCACGGCTGATCGAGCGGTTTGAGCTTCTCCAGCCAGCCCATA
>comp129_c0_seq1 len=214 path=[317:0-213]
GAGGGAACTCTTGGTTGCTCTGAATGACCAGTATGCTGAGGTAGTTGTCCAGGGTGTACT
TGTGAAACTCTTGGATCCACTGGTCTATCAGCGTGGCGGGAACCACTATCAATGTCGCCG
CGGAAAGATACATTTGCATCGCCAGAGGGAGGCCCTTCCGAGGCGTGCCATCGCCAGAGG
TGCCACGGGCTTGGGCGGCACTTTCCGAAGAACT

```

Step 2. Create config.json containing something like following (in the same director where you put input.fasta)

```
{
    "project": "OSGOpsTrain",
    "user": "hayashis",
    "input": "input.fasta",
    "db": "oasis:nt.1-22-2014",
    "blast": "blastn",
    "blast_opts": "-evalue 0.001 -outfmt 6 -best_hit_score_edge 0.05 -best_hit_overhang 0.25 -perc_identity 98.0"
}

```

You need to use the project name that you have access on your submit host. "user" should usually match the local uid. "db" is the name of blast DB that you'd like to search against.  Please see under /cvmfs/oasis.opensciencegrid.org/osg/projects/IU-GALAXY/blastdb for currently available databases. Or you can see http://xd-login.opensciencegrid.org/scratch/iugalaxy/dblist.json

Step 3. Run osg-blast

Finally, to start the workflow ..
```
osg-blast config.json 
```

osg-blast will first run submit some test jobs in order to collect some runtime information, then split the input queries and database (if user provided) into appropriate sizes, then start submitting jobs (there could be many thousands, depending on the size of your database, and input query, and your input parameters).

To abort your job, simply hit CTRL+C (or do kill $pid). If your job is large, you should use nohup

```
nohup osg-blast > stdout.txt 2> stderr.txt &
```

Step 4. Merge output

osg-blast will generate output files for each jobs under ./output directory. You can use osg-blast's merge script to merge all of your output into a single output file.

```
$ cd output
$ osg-blast-merge6
merging dbparts
merging query block 0
output.qb_0.db_0   output.qb_0.db_11  output.qb_0.db_14  output.qb_0.db_2  output.qb_0.db_5  output.qb_0.db_8
output.qb_0.db_1   output.qb_0.db_12  output.qb_0.db_15  output.qb_0.db_3  output.qb_0.db_6  output.qb_0.db_9
output.qb_0.db_10  output.qb_0.db_13  output.qb_0.db_16  output.qb_0.db_4  output.qb_0.db_7
merging query blocks
```

osg-blast-merge6 is to merge outputs in tabular format (-outfmt 6). For XML output  (-outfmt 5), use osg-blast-merge5. XML mering requires substantial amount of memory (if you are merging 100s of GB of data), so please don't merge them on your submit host.

Following is the output from the sample input file above

```
[hayashis@login01 output]$ cat merged
comp129_c0_seq1 gi|470487826|ref|XM_004344685.1|        98.44   128     2       0       1       128     128     1       7e-56     226
```

It looks like there was only 1 match for the 3rd input sequence "comp129_c0_seq1". (TODO I need to make the sample input more interesting..sorry!)

# Details

osg-blast splits your input queries, and use DB that is split into mutiple chunks (1G compressed each), and submits
all jobs on local queue in the order of required DB part number (to maximize squid hits). Any failed job will be
analyzed to see if it can be re-submitted elsewhere, and if not, then abort the entire workflow.

Every blast execution is unique, and amount of memory / cpu resources required to run blast depends on the type
of input query, db, and input parameters, etc.. so osg-blast first submits some test jobs in order to determine 
how large the each input block should be. 

osg-blast uses some hosted DB (such as those DB published by NCBI) so you don't have to have them available with 
your job. osg-blast will use ones published via OSG's OASIS.

If you want to provide your own database, you can do so, but you need to make it available via some webserver where
each job can download from (through squid).

# Hosted Databases

You can see a list of OASIS hosted blast databases here

> http://xd-login.opensciencegrid.org/scratch/iugalaxy/dblist.json

Anyone can use these databases. GOC periodically updates the content of the DB from the NCBI website. You can also provide your own database to run your job (contact hayashis@iu.edu for more info).

# License

MIT
